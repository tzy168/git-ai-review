import * as vscode from "vscode";
import { GitService } from "./gitService";
import { LLMService, getLLMConfig } from "./llmService";
import { ReportGenerator } from "./reportGenerator";
import { DocumentType } from "./prompts";

export function activate(context: vscode.ExtensionContext) {
  // ── 主命令 ──
  const startCmd = vscode.commands.registerCommand(
    "git-ai-review.start",
    () => runReview()
  );

  // ── 打开设置 ──
  const settingsCmd = vscode.commands.registerCommand(
    "git-ai-review.openSettings",
    () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:refe.git-ai-review"
      )
  );

  context.subscriptions.push(startCmd, settingsCmd);
}

async function runReview() {
  // ── 1. 检查工作区 ──
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("请先打开一个工作区文件夹");
    return;
  }
  const workspaceRoot = folders[0].uri.fsPath;

  // ── 2. 检查 API Key ──
  const config = getLLMConfig();
  if (!config.apiKey) {
    const action = await vscode.window.showErrorMessage(
      "请先配置 DeepSeek API Key",
      "去配置",
      "取消"
    );
    if (action === "去配置") {
      vscode.commands.executeCommand("git-ai-review.openSettings");
    }
    return;
  }

  // ── 3. 初始化 Git ──
  const git = new GitService(workspaceRoot);
  let currentBranch: string;
  try {
    currentBranch = await git.getCurrentBranch();
  } catch {
    vscode.window.showErrorMessage("当前工作区不是 Git 仓库");
    return;
  }

  // ── 4. 选择目标分支 ──
  const localBranches = await git.getLocalBranches();
  const remoteBranches = await git.getRemoteBranches();
  const allBranches = [...new Set([...localBranches, ...remoteBranches])];
  const candidates = allBranches.filter((b) => b !== currentBranch);

  if (candidates.length === 0) {
    vscode.window.showWarningMessage("没有可比较的分支");
    return;
  }

  // 常用目标置顶
  const prioritized = prioritizeBranches(candidates);

  const baseBranch = await vscode.window.showQuickPick(prioritized, {
    placeHolder: "选择要比较的目标分支 (base)",
    title: `当前分支: ${currentBranch}`,
    matchOnDescription: true,
  });

  if (!baseBranch) return;

  // ── 5. 获取 Diff ──
  let diffResult;
  try {
    diffResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Git Diff",
        cancellable: false,
      },
      async (progress) => {
        progress.report({
          message: `比较 ${baseBranch} ↔ ${currentBranch}...`,
        });
        return git.getDiff(baseBranch, currentBranch);
      }
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`获取 Diff 失败: ${err.message}`);
    return;
  }

  if (diffResult.fileDiffs.length === 0) {
    vscode.window.showInformationMessage(
      `${baseBranch} 和 ${currentBranch} 之间没有差异`
    );
    return;
  }

  // ── 6. 选择文档类型 ──
  const summary = `${diffResult.fileDiffs.length} 个文件, +${diffResult.totalAdditions} -${diffResult.totalDeletions}`;
  const docType = await vscode.window.showQuickPick(
    [
      { label: "$(file-text) 代码审查报告", description: "Code Review 文档", value: "review" as DocumentType },
      { label: "$(lightbulb) 技术方案文档", description: "反向推导技术实现方案", value: "tech-spec" as DocumentType },
    ],
    {
      placeHolder: `发现差异：${summary}。请选择要生成的文档类型`,
      title: "选择文档类型",
    }
  );

  if (!docType) return;

  // ── 7. 调用 LLM ──
  const llm = new LLMService(config);
  let content: string;

  const progressTitle = docType.value === "tech-spec"
    ? "AI 技术方案生成 (DeepSeek)"
    : "AI Code Review (DeepSeek)";

  try {
    content = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: progressTitle,
        cancellable: false,
      },
      async (progress) => {
        return llm.generate(diffResult, docType.value, (msg) =>
          progress.report({ message: msg })
        );
      }
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(err.message);
    return;
  }

  // ── 8. 生成报告文件 ──
  const outputDir = vscode.workspace
    .getConfiguration("git-ai-review")
    .get<string>("reportOutputDir", "");

  try {
    const filePath = await ReportGenerator.generate(
      workspaceRoot,
      diffResult,
      content,
      docType.value,
      outputDir || undefined
    );

    const docLabel = docType.value === "tech-spec" ? "技术方案" : "Review 报告";
    vscode.window.showInformationMessage(
      `${docLabel}已生成: ${filePath.split(/[/\\]/).pop()}`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`生成报告文件失败: ${err.message}`);
  }
}

/** 将常用目标分支排在前面 */
function prioritizeBranches(branches: string[]): string[] {
  const priority = ["main", "master", "develop", "dev", "release", "staging"];

  const sorted = [...branches].sort((a, b) => {
    const aIdx = priority.findIndex((p) =>
      a.toLowerCase().includes(p)
    );
    const bIdx = priority.findIndex((p) =>
      b.toLowerCase().includes(p)
    );

    // 都匹配 → 按 priority 顺序
    if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
    // 只有一个匹配 → 排前面
    if (aIdx >= 0) return -1;
    if (bIdx >= 0) return 1;
    // 都不匹配 → 字母序
    return a.localeCompare(b);
  });

  return sorted;
}

export function deactivate() {}

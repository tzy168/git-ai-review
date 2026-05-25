import simpleGit, { SimpleGit } from "simple-git";

export interface FileDiff {
  filePath: string;
  additions: number;
  deletions: number;
  diff: string;
}

export interface DiffResult {
  baseBranch: string;
  headBranch: string;
  fileDiffs: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}

export class GitService {
  private git: SimpleGit;

  constructor(private workspaceRoot: string) {
    this.git = simpleGit(workspaceRoot);
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || "unknown";
  }

  async getLocalBranches(): Promise<string[]> {
    const branches = await this.git.branchLocal();
    return branches.all;
  }

  async getRemoteBranches(): Promise<string[]> {
    try {
      const branches = await this.git.branch(["-r"]);
      return branches.all.map((b) => b.replace(/^origin\//, ""));
    } catch {
      return [];
    }
  }

  /**
   * 获取当前分支中存在、但目标分支中不存在的提交对应的 diff，按文件拆分。
   * 等价于 git diff baseBranch...headBranch，即 merge-base(base, head) 到 head 的差异。
   */
  async getDiff(baseBranch: string, headBranch: string): Promise<DiffResult> {
    // 确保分支存在
    await this.ensureBranchExists(baseBranch);
    const diffRange = `${baseBranch}...${headBranch}`;

    const fileDiffs: FileDiff[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    // 获取变更文件列表及统计
    const diffSummary = await this.git.diffSummary([diffRange]);

    for (const file of diffSummary.files) {
      const filePath = "file" in file ? file.file : (file as any).file;

      // 获取单个文件的 diff
      const diff = await this.git.diff([diffRange, "--", filePath]);

      // 统计
      const adds = (diff.match(/^\+[^+]/gm) || []).length;
      const dels = (diff.match(/^-[^-]/gm) || []).length;

      totalAdditions += adds;
      totalDeletions += dels;

      fileDiffs.push({
        filePath,
        additions: adds,
        deletions: dels,
        diff,
      });
    }

    return {
      baseBranch,
      headBranch,
      fileDiffs,
      totalAdditions,
      totalDeletions,
    };
  }

  /** 检查分支是否存在，不存在则尝试 fetch */
  private async ensureBranchExists(branch: string): Promise<void> {
    const local = await this.git.branchLocal();
    if (local.all.includes(branch)) return;

    // 尝试作为远程分支处理
    try {
      await this.git.fetch("origin", branch);
    } catch {
      throw new Error(`分支 "${branch}" 不存在`);
    }
  }
}

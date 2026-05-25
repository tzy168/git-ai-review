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

  async getDiff(baseBranch: string, headBranch: string): Promise<DiffResult> {
    await this.ensureBranchExists(baseBranch);

    const mergeBase = (await this.git.raw(["merge-base", baseBranch, headBranch])).trim();

    const fileDiffs: FileDiff[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    const diffSummary = await this.git.diffSummary([mergeBase, headBranch]);

    for (const file of diffSummary.files) {
      const filePath = "file" in file ? file.file : (file as any).file;

      const diff = await this.git.diff([mergeBase, headBranch, "--", filePath]);

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

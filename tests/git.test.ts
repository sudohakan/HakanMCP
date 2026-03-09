import { gitTools } from '../src/tools/git';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';

describe('Git Tools', () => {
  let testRepoPath: string;

  beforeEach(async () => {
    // Create a unique test repository directory
    testRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'test-git-repo-'));
    const git = simpleGit(testRepoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Create initial file
    fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Test Repo', 'utf8');
    await git.add('README.md');
    await git.commit('Initial commit');
  });

  afterEach(() => {
    // Clean up test repo
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  describe('git_status', () => {
    it('should get repository status', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_status');
      expect(tool).toBeDefined();

      const result = await tool!.handler({ repoPath: testRepoPath });

      const response = JSON.parse(result.content[0].text);
      expect(response.current).toBeDefined();
      expect(response.files).toBeInstanceOf(Array);
    });

    it('should detect new files', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_status');

      // Create a new file
      fs.writeFileSync(path.join(testRepoPath, 'new-file.txt'), 'content', 'utf8');

      const result = await tool!.handler({ repoPath: testRepoPath });

      const response = JSON.parse(result.content[0].text);
      expect(response.files.length).toBeGreaterThan(0);
      expect(response.files.some((f: { path?: string }) => f.path === 'new-file.txt')).toBe(true);
    });
  });

  describe('git_log', () => {
    it('should get commit history', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_log');

      const result = await tool!.handler({ repoPath: testRepoPath, maxCount: 10 });

      const response = JSON.parse(result.content[0].text);
      expect(response.total).toBeGreaterThanOrEqual(1);
      expect(response.commits).toBeInstanceOf(Array);
      expect(response.commits[0].hash).toBeDefined();
      expect(response.commits[0].message).toBe('Initial commit');
    });

    it('should limit number of commits', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_log');

      // Add more commits
      const git = simpleGit(testRepoPath);
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(path.join(testRepoPath, `file${i}.txt`), `Content ${i}`, 'utf8');
        await git.add(`file${i}.txt`);
        await git.commit(`Commit ${i}`);
      }

      const result = await tool!.handler({ repoPath: testRepoPath, maxCount: 3 });

      const response = JSON.parse(result.content[0].text);
      expect(response.commits.length).toBe(3);
    });
  });

  describe('git_diff', () => {
    it('should show unstaged changes', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_diff');

      // Modify existing file
      fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Modified Content', 'utf8');

      const result = await tool!.handler({ repoPath: testRepoPath });

      expect(result.content[0].text).toContain('Modified Content');
    });

    it('should return no changes when nothing modified', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_diff');

      const result = await tool!.handler({ repoPath: testRepoPath });

      expect(result.content[0].text).toBe('No changes');
    });
  });

  describe('git_branch', () => {
    it('should list branches', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_branch');

      const result = await tool!.handler({ repoPath: testRepoPath });

      const response = JSON.parse(result.content[0].text);
      expect(response.current).toBeDefined();
      expect(response.all).toBeInstanceOf(Array);
      expect(response.all.length).toBeGreaterThan(0);
    });
  });

  describe('git_add', () => {
    it('should stage files', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_add');

      // Create new file
      const filename = 'test-add.txt';
      fs.writeFileSync(path.join(testRepoPath, filename), 'content', 'utf8');

      const result = await tool!.handler({
        repoPath: testRepoPath,
        files: [filename],
      });

      expect(result.content[0].text).toContain('Staged');
      expect(result.content[0].text).toContain(filename);

      // Verify file is staged
      const git = simpleGit(testRepoPath);
      const status = await git.status();
      expect(status.staged.some((f) => f === filename)).toBe(true);
    });

    it('should stage multiple files', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_add');

      const files = ['file1.txt', 'file2.txt', 'file3.txt'];
      files.forEach((f) => {
        fs.writeFileSync(path.join(testRepoPath, f), 'content', 'utf8');
      });

      const result = await tool!.handler({
        repoPath: testRepoPath,
        files,
      });

      expect(result.content[0].text).toContain('Staged');

      // Verify all files are staged
      const git = simpleGit(testRepoPath);
      const status = await git.status();
      files.forEach((f) => {
        expect(status.staged.some((sf) => sf === f)).toBe(true);
      });
    });
  });

  describe('git_commit', () => {
    it('should create commit', async () => {
      const addTool = gitTools.find((t: { name: string }) => t.name === 'git_add');
      const commitTool = gitTools.find((t: { name: string }) => t.name === 'git_commit');

      // Create and stage file
      const filename = 'commit-test.txt';
      fs.writeFileSync(path.join(testRepoPath, filename), 'content', 'utf8');
      await addTool!.handler({ repoPath: testRepoPath, files: [filename] });

      // Commit
      const result = await commitTool!.handler({
        repoPath: testRepoPath,
        message: 'Test commit',
      });

      expect(result.content[0].text).toContain('Commit created');
      expect(result.content[0].text).toContain('changes');
    });
  });

  describe('git_checkout', () => {
    it('should create and checkout new branch', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_checkout');

      const result = await tool!.handler({
        repoPath: testRepoPath,
        branch: 'feature-branch',
        create: true,
      });

      expect(result.content[0].text).toContain('Checked out');
      expect(result.content[0].text).toContain('feature-branch');

      // Verify branch exists and is current
      const git = simpleGit(testRepoPath);
      const branches = await git.branch();
      expect(branches.current).toBe('feature-branch');
    });

    it('should checkout existing branch', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_checkout');

      // Create a new branch first
      const git = simpleGit(testRepoPath);
      await git.checkoutLocalBranch('test-branch');
      await git.checkout('master');

      // Now checkout the created branch
      const result = await tool!.handler({
        repoPath: testRepoPath,
        branch: 'test-branch',
        create: false,
      });

      expect(result.content[0].text).toContain('Checked out');

      const branches = await git.branch();
      expect(branches.current).toBe('test-branch');
    });
  });

  describe('git_reset', () => {
    it('should reset soft', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_reset');
      const git = simpleGit(testRepoPath);

      // Create and commit a file
      fs.writeFileSync(path.join(testRepoPath, 'reset-test.txt'), 'content', 'utf8');
      await git.add('reset-test.txt');
      await git.commit('To be reset');

      const result = await tool!.handler({
        repoPath: testRepoPath,
        mode: 'soft',
        target: 'HEAD~1',
      });

      expect(result.content[0].text).toContain('Reset');
      expect(result.content[0].text).toContain('soft');
    });

    it('should reset mixed', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_reset');

      const result = await tool!.handler({
        repoPath: testRepoPath,
        mode: 'mixed',
        target: 'HEAD',
      });

      expect(result.content[0].text).toContain('Reset');
      expect(result.content[0].text).toContain('mixed');
    });
  });

  describe('git_clone', () => {
    it('should clone repository', async () => {
      const tool = gitTools.find((t: { name: string }) => t.name === 'git_clone');
      const cloneDest = path.join(os.tmpdir(), 'cloned-repo');

      // Clean up first
      if (fs.existsSync(cloneDest)) {
        fs.rmSync(cloneDest, { recursive: true, force: true });
      }

      try {
        const result = await tool!.handler({
          remoteUrl: testRepoPath, // Use local repo as "remote"
          destination: cloneDest,
        });

        expect(result.content[0].text).toContain('Cloned');
        expect(fs.existsSync(cloneDest)).toBe(true);
        expect(fs.existsSync(path.join(cloneDest, '.git'))).toBe(true);
      } finally {
        if (fs.existsSync(cloneDest)) {
          fs.rmSync(cloneDest, { recursive: true, force: true });
        }
      }
    }, 30000);
  });

  describe('git_push and git_pull', () => {
    it('should prepare for push/pull operations', async () => {
      // Note: Actual push/pull tests would require a remote repository
      // This test just verifies the tool structure

      const pushTool = gitTools.find((t: { name: string }) => t.name === 'git_push');
      const pullTool = gitTools.find((t: { name: string }) => t.name === 'git_pull');

      expect(pushTool).toBeDefined();
      expect(pullTool).toBeDefined();
      expect(pushTool!.inputSchema).toBeDefined();
      expect(pullTool!.inputSchema).toBeDefined();
    });
  });
});

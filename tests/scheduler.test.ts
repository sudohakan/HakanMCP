import { schedulerTools, schedulerManager } from '../src/tools/scheduler';
import { config } from '../src/config';

describe('Scheduler Tools', () => {
  let createdTaskId: string | null = null;

  beforeAll(() => {
    // Enable scheduler for tests
    if (!config.scheduler) {
      (config as Record<string, unknown>).scheduler = {
        enabled: true,
        maxConcurrentTasks: 5,
        taskHistoryRetentionDays: 30,
        persistencePath: './test-scheduler-state.json',
      };
    } else {
      config.scheduler.enabled = true;
    }
  });

  afterAll(() => {
    schedulerManager.shutdown();
  });

  afterEach(async () => {
    // Clean up created tasks
    if (createdTaskId) {
      const deleteTool = schedulerTools.find((t) => t.name === 'scheduler_deleteTask');
      if (deleteTool) {
        await deleteTool.handler({ taskId: createdTaskId });
        createdTaskId = null;
      }
    }
  });

  describe('scheduler_createTask', () => {
    it('should create a new scheduled task', async () => {
      const tool = schedulerTools.find((t) => t.name === 'scheduler_createTask');
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        name: 'test-task',
        schedule: '*/5 * * * *', // Every 5 minutes
        agentTask: 'Test task execution',
        enabled: false, // Don't actually run it
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('✅ Scheduled task created');

      // Extract task ID from response for cleanup
      const match = result.content[0].text.match(/\*\*ID:\*\* (task-[^\n]+)/);
      if (match) {
        createdTaskId = match[1];
      }
    });

    it('should reject invalid cron schedule', async () => {
      const tool = schedulerTools.find((t) => t.name === 'scheduler_createTask');

      try {
        await tool!.handler({
          name: 'invalid-task',
          schedule: 'invalid-cron',
          agentTask: 'Test task',
          enabled: false,
        });
        fail('Should have thrown an error');
      } catch (error: unknown) {
        expect(error.message).toContain('Invalid cron schedule');
      }
    });
  });

  describe('scheduler_listTasks', () => {
    it('should list all scheduled tasks', async () => {
      const createTool = schedulerTools.find((t) => t.name === 'scheduler_createTask');
      const listTool = schedulerTools.find((t) => t.name === 'scheduler_listTasks');

      expect(createTool).toBeDefined();
      expect(listTool).toBeDefined();

      // Create a test task
      const createResult = await createTool!.handler({
        name: 'list-test-task',
        schedule: '0 0 * * *',
        agentTask: 'Daily test',
        enabled: false,
      });

      const match = createResult.content[0].text.match(/\*\*ID:\*\* (task-[^\n]+)/);
      if (match) {
        createdTaskId = match[1];
      }

      // List tasks
      const listResult = await listTool!.handler({});
      expect(listResult.content).toBeDefined();
      expect(listResult.content[0].text).toContain('list-test-task');
    });
  });

  describe('scheduler_getTask', () => {
    it('should get task details', async () => {
      const createTool = schedulerTools.find((t) => t.name === 'scheduler_createTask');
      const getTool = schedulerTools.find((t) => t.name === 'scheduler_getTask');

      // Create a test task
      const createResult = await createTool!.handler({
        name: 'detail-test-task',
        schedule: '0 */6 * * *',
        agentTask: 'Every 6 hours test',
        enabled: false,
      });

      const match = createResult.content[0].text.match(/\*\*ID:\*\* (task-[^\n]+)/);
      expect(match).toBeDefined();
      createdTaskId = match![1];

      // Get task details
      const getResult = await getTool!.handler({ taskId: createdTaskId });
      expect(getResult.content[0].text).toContain('detail-test-task');
      expect(getResult.content[0].text).toContain('0 */6 * * *');
    });

    it('should return error for non-existent task', async () => {
      const getTool = schedulerTools.find((t) => t.name === 'scheduler_getTask');

      const result = await getTool!.handler({ taskId: 'non-existent-task' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('❌ Task not found');
    });
  });

  describe('scheduler_pauseTask and scheduler_resumeTask', () => {
    it('should pause and resume a task', async () => {
      const createTool = schedulerTools.find((t) => t.name === 'scheduler_createTask');
      const pauseTool = schedulerTools.find((t) => t.name === 'scheduler_pauseTask');
      const resumeTool = schedulerTools.find((t) => t.name === 'scheduler_resumeTask');
      const getTool = schedulerTools.find((t) => t.name === 'scheduler_getTask');

      // Create an enabled task
      const createResult = await createTool!.handler({
        name: 'pause-test-task',
        schedule: '0 0 * * *',
        agentTask: 'Pause test',
        enabled: true,
      });

      const match = createResult.content[0].text.match(/\*\*ID:\*\* (task-[^\n]+)/);
      createdTaskId = match![1];

      // Pause the task
      await pauseTool!.handler({ taskId: createdTaskId });

      let getResult = await getTool!.handler({ taskId: createdTaskId });
      expect(getResult.content[0].text).toContain('⏸️ Pasif');

      // Resume the task
      await resumeTool!.handler({ taskId: createdTaskId });

      getResult = await getTool!.handler({ taskId: createdTaskId });
      expect(getResult.content[0].text).toContain('✅ Aktif');
    });
  });

  describe('scheduler_updateTask', () => {
    it('should update task properties', async () => {
      const createTool = schedulerTools.find((t) => t.name === 'scheduler_createTask');
      const updateTool = schedulerTools.find((t) => t.name === 'scheduler_updateTask');
      const getTool = schedulerTools.find((t) => t.name === 'scheduler_getTask');

      // Create a task
      const createResult = await createTool!.handler({
        name: 'update-test-task',
        schedule: '0 0 * * *',
        agentTask: 'Original task',
        enabled: false,
      });

      const match = createResult.content[0].text.match(/\*\*ID:\*\* (task-[^\n]+)/);
      createdTaskId = match![1];

      // Update the task
      await updateTool!.handler({
        taskId: createdTaskId,
        name: 'updated-task-name',
        schedule: '0 12 * * *',
      });

      // Verify update
      const getResult = await getTool!.handler({ taskId: createdTaskId });
      expect(getResult.content[0].text).toContain('updated-task-name');
      expect(getResult.content[0].text).toContain('0 12 * * *');
    });
  });

  describe('scheduler_deleteTask', () => {
    it('should delete a task', async () => {
      const createTool = schedulerTools.find((t) => t.name === 'scheduler_createTask');
      const deleteTool = schedulerTools.find((t) => t.name === 'scheduler_deleteTask');
      const getTool = schedulerTools.find((t) => t.name === 'scheduler_getTask');

      // Create a task
      const createResult = await createTool!.handler({
        name: 'delete-test-task',
        schedule: '0 0 * * *',
        agentTask: 'To be deleted',
        enabled: false,
      });

      const match = createResult.content[0].text.match(/\*\*ID:\*\* (task-[^\n]+)/);
      const taskId = match![1];

      // Delete the task
      const deleteResult = await deleteTool!.handler({ taskId });
      expect(deleteResult.content[0].text).toContain('✅ Task deleted');

      // Verify deletion
      const getResult = await getTool!.handler({ taskId });
      expect(getResult.isError).toBe(true);
    });
  });

  describe('scheduler_getStats', () => {
    it('should return scheduler statistics', async () => {
      const statsTool = schedulerTools.find((t) => t.name === 'scheduler_getStats');

      const result = await statsTool!.handler({});
      expect(result.content[0].text).toContain('Scheduler Statistics');
      expect(result.content[0].text).toContain('Toplam:');
      expect(result.content[0].text).toContain('Aktif:');
      expect(result.content[0].text).toContain('Pasif:');
    });
  });

  describe('scheduler_getHistory', () => {
    it('should return execution history', async () => {
      const historyTool = schedulerTools.find((t) => t.name === 'scheduler_getHistory');

      const result = await historyTool!.handler({ limit: 10 });
      expect(result.content).toBeDefined();
      // History may be empty if no tasks have been executed
    });
  });
});

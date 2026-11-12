export default { test: { include: ['tests/*.test.mjs'], pool: 'forks', isolate: false, fileParallelism: true, maxWorkers: 2, teardownTimeout: 20000 } };

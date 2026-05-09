module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: {
    '^@rawclaw/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@rawclaw/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};

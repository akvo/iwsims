import crudUsers from '../crud-users';

jest.mock('expo-sqlite');

// Mock the hook instead of calling it directly
jest.mock('expo-sqlite', () => ({
  ...jest.requireActual('expo-sqlite'),
  useSQLiteContext: jest.fn().mockReturnValue({
    transaction: jest.fn(),
    closeAsync: jest.fn(),
  }),
}));

const mockDb = {
  transaction: jest.fn(),
  closeAsync: jest.fn(),
};

const users = [
  {
    id: 1,
    name: 'John Doe',
    password: 'password',
    active: 1,
  },
  {
    id: 2,
    name: 'Jane Doe',
    password: 'password',
    active: 0,
  },
];

describe('crudUsers function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getActiveUser', () => {
    it('should return false if active user does not exist', async () => {
      const mockData = [];
      const mockSelectSql = jest.fn((query, params, successCallback) => {
        successCallback(null, { rows: { length: mockData.length, _array: mockData } });
      });
      mockDb.transaction.mockImplementation((transactionFunction) => {
        transactionFunction({
          executeSql: mockSelectSql,
        });
      });
      const result = await crudUsers.getActiveUser();
      expect(result).toBe(false);
    });

    it('should return active user', async () => {
      const mockData = users.filter((u) => u.active);
      const mockSelectSql = jest.fn((query, params, successCallback) => {
        successCallback(null, { rows: { length: mockData.length, _array: mockData } });
      });
      mockDb.transaction.mockImplementation((transactionFunction) => {
        transactionFunction({
          executeSql: mockSelectSql,
        });
      });
      const result = await crudUsers.getActiveUser();
      expect(result).toEqual(mockData[0]);
    });
  });
});

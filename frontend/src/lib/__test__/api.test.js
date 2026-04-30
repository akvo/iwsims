import "@testing-library/jest-dom";
import api from "../api";
import MockAdapter from "axios-mock-adapter";
import axios from "axios";

jest.mock("axios");

// jest.mock("axios") auto-mocks every export, including axios.isCancel.
// Restore the real implementation so api.isCancel reflects production
// behaviour in tests.
const realAxios = jest.requireActual("axios");
axios.isCancel = realAxios.isCancel;
axios.Cancel = realAxios.Cancel;
axios.CanceledError = realAxios.CanceledError;

const fakeToken = "eyJhbGciOiJIUzI1NiIsInR56IkpXVCxxxxxxxxxxx";

const fetchUsers = async () => {
  try {
    const users = await api.get();
    return users;
  } catch (err) {
    return [];
  }
};

const headers = {
  Accept: "application/json, text/plain, */*",
  Authorization: `Bearer ${fakeToken}`,
  "Content-Type": "application/json",
};

describe("lib/api", () => {
  let mock;

  beforeAll(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.reset();
  });

  test("test if token is being stored in the api sending the correct headers", async () => {
    api.setToken(fakeToken);
    expect(api.token).toStrictEqual(fakeToken);

    mock.onGet("something").reply((config) => {
      expect(config.baseURL).toEqual("/api/v1/");
      expect(config.headers).toEqual(headers);
      return [200, {}];
    });
    const result = await api.get("something");
    expect(result).toBeUndefined();
  });

  describe("mock a GET request", () => {
    let originalApiGet;
    beforeAll(() => {
      originalApiGet = api.get;
    });
    afterAll(() => {
      api.get = originalApiGet;
    });
    it("should return users list", async () => {
      const users = [
        { id: 1, name: "John" },
        { id: 2, name: "Andrew" },
      ];
      api.get = jest.fn().mockResolvedValue(users);
      const result = await fetchUsers();
      expect(result).toEqual(users);
      expect(api.get).toHaveBeenCalledWith();
    });
  });
  describe("POST", () => {
    it("test a POST request", async () => {
      const payload = {
        email: "toky@gmail.com",
        password: "FaTo!2&",
      };
      mock.onPost("/login", payload).reply((config) => {
        expect(config.baseURL).toEqual("/api/v1/");
        expect(config.headers).toEqual(headers);
        return [200, {}];
      });
      await api.post("/login", payload);
    });
  });

  describe("PUT request", () => {
    test("test a PUT request", async () => {
      mock
        .onPut("/something", { id: 2, name: "PUT requests" })
        .reply((config) => {
          expect(config.headers).toEqual(headers);
          return [200];
        });
      await api.put("/something", { id: 2, name: "PUT requests" });
    });
  });

  describe("API Object", () => {
    test("snapshot api calls", () => {
      expect(api).toMatchSnapshot();
    });
  });

  describe("cancel-key behaviour", () => {
    // These tests bypass MockAdapter and drive axios.mockImplementation
    // directly so we can observe the AbortSignal that the api wrapper
    // attaches and verify lifecycle (abort + finally cleanup).

    afterEach(() => {
      axios.mockReset();
    });

    test("calls without a cancelKey leave config.signal undefined", async () => {
      let seen = "not-set";
      axios.mockImplementation((config) => {
        seen = config.signal;
        return Promise.resolve({ data: {} });
      });

      await api.get("/no-key");
      expect(seen).toBeUndefined();
    });

    test("calls with a cancelKey attach a fresh, non-aborted signal", () => {
      const captured = [];
      axios.mockImplementation((config) => {
        captured.push(config);
        return new Promise(() => {}); // stay in-flight
      });

      api.get("/with-key", {}, "test:fresh-key");
      expect(captured).toHaveLength(1);
      expect(captured[0].signal).toBeDefined();
      expect(captured[0].signal.aborted).toBe(false);
    });

    test("different cancelKeys do not abort each other", () => {
      const captured = [];
      axios.mockImplementation((config) => {
        captured.push(config);
        return new Promise(() => {});
      });

      api.get("/a", {}, "test:key-A");
      api.get("/b", {}, "test:key-B");

      expect(captured[0].signal.aborted).toBe(false);
      expect(captured[1].signal.aborted).toBe(false);
    });

    test("reusing a cancelKey aborts the previous request's signal", () => {
      const captured = [];
      axios.mockImplementation((config) => {
        captured.push(config);
        return new Promise(() => {});
      });

      api.get("/r", {}, "test:reuse-abort");
      api.get("/r", {}, "test:reuse-abort");

      // First call's signal should be aborted by the second; second is fresh.
      expect(captured[0].signal.aborted).toBe(true);
      expect(captured[1].signal.aborted).toBe(false);
    });

    test("reusing a cancelKey causes api.isCancel to identify the rejection", async () => {
      // Mock axios to honour the abort signal: rejects with a real
      // axios.Cancel when controller fires, mirroring production axios.
      axios.mockImplementation((config) => {
        return new Promise((resolve, reject) => {
          if (config.signal) {
            config.signal.addEventListener("abort", () => {
              reject(new realAxios.Cancel("Request aborted"));
            });
          }
        });
      });

      const firstError = api
        .get("/c", {}, "test:cancel-detect")
        .catch((err) => err);
      // Trigger abort by reusing the key.
      const secondPending = api
        .get("/c", {}, "test:cancel-detect")
        .catch(() => null);

      const err = await firstError;
      expect(api.isCancel(err)).toBe(true);
      // Ensure the second pending promise doesn't leak between tests.
      // It's stalled by design; we don't need its resolution, just give
      // jest a clean handle to drop it.
      expect(secondPending).toBeInstanceOf(Promise);
    });

    test("api.isCancel returns false for ordinary errors", () => {
      expect(api.isCancel(new Error("network down"))).toBe(false);
      expect(api.isCancel(null)).toBe(false);
    });

    test("inflight entry is cleared after the request settles", async () => {
      // Drive a successful resolution and then a follow-up call with the
      // same key. Because the .finally() guard cleared the prior entry,
      // there is no controller to abort on the second call.
      const captured = [];
      axios.mockImplementation((config) => {
        captured.push(config);
        return Promise.resolve({ data: {} });
      });

      await api.get("/x", {}, "test:cleanup-key");
      await api.get("/x", {}, "test:cleanup-key");

      // Both calls observed a fresh, non-aborted signal — i.e., the second
      // call did NOT find a stale controller from the first to abort.
      expect(captured[0].signal.aborted).toBe(false);
      expect(captured[1].signal.aborted).toBe(false);
    });
  });
});

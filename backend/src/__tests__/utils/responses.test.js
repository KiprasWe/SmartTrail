import { describe, it, expect, vi } from "vitest";
import {
  Errors,
  Success,
  sendError,
  sendSuccess,
  setupSSE,
  PipelineError,
} from "../../utils/responses.js";

function mockRes() {
  return {
    _status: null,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
}

describe("sendError", () => {
  it("sets the correct HTTP status and error shape", () => {
    const res = mockRes();
    sendError(res, Errors.INVALID_LOGIN);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ status: "error", code: "INVALID_LOGIN" });
  });

  it("merges extra details into the body", () => {
    const res = mockRes();
    sendError(res, Errors.INVALID_REQUEST, {
      issues: [{ field: "email", message: "Invalid" }],
    });
    expect(res._body.issues).toEqual([{ field: "email", message: "Invalid" }]);
  });

  it("includes message when present on the error definition", () => {
    const res = mockRes();
    sendError(res, { ...Errors.BAD_REQUEST, message: "extra context" });
    expect(res._body.message).toBe("extra context");
  });

  it("does not include message key when absent", () => {
    const res = mockRes();
    sendError(res, Errors.INVALID_LOGIN);
    expect(Object.keys(res._body)).not.toContain("message");
  });

  it("uses 502 status for EXTERNAL_SERVICE_ERROR", () => {
    const res = mockRes();
    sendError(res, Errors.EXTERNAL_SERVICE_ERROR);
    expect(res._status).toBe(502);
  });

  it("uses 500 status for INTERNAL_SERVER_ERROR", () => {
    const res = mockRes();
    sendError(res, Errors.INTERNAL_SERVER_ERROR);
    expect(res._status).toBe(500);
  });

  it("uses 404 for ROUTE_NOT_FOUND", () => {
    const res = mockRes();
    sendError(res, Errors.ROUTE_NOT_FOUND);
    expect(res._status).toBe(404);
  });

  it("uses 403 for ROUTE_ACCESS_DENIED", () => {
    const res = mockRes();
    sendError(res, Errors.ROUTE_ACCESS_DENIED);
    expect(res._status).toBe(403);
  });
});

describe("sendSuccess", () => {
  it("sets the correct HTTP status and success shape", () => {
    const res = mockRes();
    sendSuccess(res, Success.USER_CREATED, { id: "123" });
    expect(res._status).toBe(201);
    expect(res._body).toEqual({
      status: "success",
      code: "USER_CREATED",
      data: { id: "123" },
    });
  });

  it("defaults data to an empty object", () => {
    const res = mockRes();
    sendSuccess(res, Success.USER_LOGGED_OUT);
    expect(res._body.data).toEqual({});
  });

  it("uses 200 for USER_LOGGED_IN", () => {
    const res = mockRes();
    sendSuccess(res, Success.USER_LOGGED_IN);
    expect(res._status).toBe(200);
  });

  it("uses 201 for ROUTE_SAVED", () => {
    const res = mockRes();
    sendSuccess(res, Success.ROUTE_SAVED);
    expect(res._status).toBe(201);
  });
});

describe("PipelineError", () => {
  it("is an instance of Error", () => {
    const err = new PipelineError(Errors.AI_GENERATION_FAILED);
    expect(err).toBeInstanceOf(Error);
  });

  it("stores errorDef", () => {
    const err = new PipelineError(Errors.AI_GENERATION_FAILED);
    expect(err.errorDef).toBe(Errors.AI_GENERATION_FAILED);
  });

  it("uses the error code as message when no message provided", () => {
    const err = new PipelineError(Errors.AI_GENERATION_FAILED);
    expect(err.message).toBe("AI_GENERATION_FAILED");
  });

  it("uses the provided message when supplied", () => {
    const err = new PipelineError(Errors.AI_GENERATION_FAILED, "pipeline step 3 failed");
    expect(err.message).toBe("pipeline step 3 failed");
  });
});

describe("setupSSE", () => {
  function makeSseRes() {
    const written = [];
    return {
      written,
      _status: null,
      _headers: null,
      writableEnded: false,
      status() {
        return this;
      },
      set(headers) {
        this._headers = headers;
        return this;
      },
      flushHeaders: vi.fn(),
      write(chunk) {
        written.push(chunk);
      },
    };
  }

  it("sets SSE response headers", () => {
    const res = makeSseRes();
    setupSSE(res);
    expect(res._headers["Content-Type"]).toBe("text/event-stream");
    expect(res._headers["Cache-Control"]).toContain("no-cache");
  });

  it("emits correctly formatted SSE frames", () => {
    const res = makeSseRes();
    const emit = setupSSE(res);
    emit("stage", { step: 1 });
    expect(res.written).toContain("event: stage\n");
    expect(res.written).toContain('data: {"step":1}\n\n');
  });

  it("does nothing when writableEnded is true", () => {
    const res = makeSseRes();
    res.writableEnded = true;
    const emit = setupSSE(res);
    emit("stage", { step: 1 });
    expect(res.written).toHaveLength(0);
  });

  it("serialises data as JSON", () => {
    const res = makeSseRes();
    const emit = setupSSE(res);
    emit("done", { routes: [1, 2, 3] });
    const dataLine = res.written.find((l) => l.startsWith("data:"));
    expect(JSON.parse(dataLine.replace("data: ", ""))).toEqual({
      routes: [1, 2, 3],
    });
  });
});

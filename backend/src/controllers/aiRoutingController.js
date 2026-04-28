import { asyncHandler } from "../utils/asyncHandler.js";
import {
  sendError,
  sendSuccess,
  setupSSE,
  PipelineError,
  Errors,
  Success,
} from "../utils/responses.js";
import { runAiPipeline } from "../lib/ai/pipeline.js";

export const aiRouting = asyncHandler(async (req, res) => {
  try {
    const data = await runAiPipeline(req.body);
    return sendSuccess(res, Success.ROUTE_GENERATED, data);
  } catch (err) {
    if (err instanceof PipelineError) {
      return sendError(res, { ...err.errorDef, message: err.message });
    }
    throw err;
  }
});

export const aiRoutingStream = asyncHandler(async (req, res) => {
  const emit = setupSSE(res);

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
  });

  try {
    const data = await runAiPipeline(req.body, {
      onStage: (stage, extra = {}) => {
        if (!clientGone) emit("stage", { stage, ...extra });
      },
    });
    if (!clientGone) emit("done", data);
  } catch (err) {
    if (!clientGone) {
      if (err instanceof PipelineError) {
        emit("error", { code: err.errorDef.code, message: err.message });
      } else {
        console.error("[aiRoutingStream] unexpected error:", err);
        emit("error", {
          code: Errors.INTERNAL_SERVER_ERROR.code,
          message: err.message ?? "Internal server error",
        });
      }
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

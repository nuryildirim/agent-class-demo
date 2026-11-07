// The agent's custom tools.
//
// A "tool" is a function the agent can choose to call. We describe it with a
// name, a description (which the model reads), and an input schema (written
// with the Zod library). The Agent SDK serves our tools to the model through
// an in-process MCP server, which is just a container for a list of tools.
//
// Step 1 has only one tool: get_receipt. It is read-only. It returns the
// receipt image itself, so the model "looks at" the receipt the same way it
// would look at an image a person uploaded.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// The fake receipts made by scripts/make-sample-receipts.mjs.
// Listing them explicitly means the agent can only ask for these files,
// never an arbitrary path on the computer.
export const RECEIPT_IDS = ["meal-clear", "meal-blurry"] as const;
export type ReceiptId = (typeof RECEIPT_IDS)[number];

const RECEIPTS_DIR = path.join(process.cwd(), "data", "receipts");

const getReceipt = tool(
  "get_receipt",
  "Get the image of a submitted receipt so you can read it.",
  {
    receipt_id: z.enum(RECEIPT_IDS).describe("The ID of the receipt to fetch"),
  },
  async ({ receipt_id }) => {
    const bytes = await readFile(path.join(RECEIPTS_DIR, `${receipt_id}.png`));

    // A tool result is a list of content blocks. An "image" block carries the
    // picture as base64 text (no "data:image/png;base64," prefix).
    return {
      content: [
        { type: "text", text: `Receipt ${receipt_id}:` },
        { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
      ],
    };
  },
  // readOnlyHint tells the SDK this tool changes nothing.
  // alwaysLoad puts the tool in the model's prompt from the start, instead of
  // making the model search for it first (the SDK's default "tool search").
  { annotations: { readOnlyHint: true }, alwaysLoad: true }
);

// The server's name ("expenses") becomes part of each tool's full name:
// mcp__expenses__get_receipt
export const expenseToolServer = createSdkMcpServer({
  name: "expenses",
  version: "0.1.0",
  tools: [getReceipt],
});

export const ALLOWED_TOOLS = ["mcp__expenses__get_receipt"];

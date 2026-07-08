import type { WorkerEnv } from "../env";
import { intentJsonSchema, type BotIntent } from "./intent-schema";
import { buildIntentPrompt } from "./prompts";
import OpenAI from "openai";

export type IntentContext = {
  text: string;
  replyToBot: boolean;
  predictionsOpen: boolean;
  latestBotPrompt?: string | null;
  activeMatch?: {
    participant1: string;
    participant2: string;
  } | null;
};

export class IntentRouter {
  constructor(private readonly env: Pick<WorkerEnv, "AI_API_KEY">) {}

  async route(context: IntentContext): Promise<BotIntent> {
    if (!this.env.AI_API_KEY) {
      throw new Error("AI_API_KEY is not set in the environment");
    }

    try {
      const client = new OpenAI({
        apiKey: this.env.AI_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      });

      const response = await client.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "user",
            content: buildIntentPrompt(context)
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "touchline_intent",
            strict: true,
            schema: intentJsonSchema
          }
        },
        temperature: 0
      });

      const outputText = response.choices[0]?.message.content;
      if (!outputText) {
        throw new Error("Failed to get a valid response from the AI model");
      }
      return JSON.parse(outputText) as BotIntent;
    } catch(error) {
      console.log(error)
      return {
        intent: "unclear",
        confidence: 0,
        match: { team1: null, team2: null },
        prediction: null,
        teamQuery: null,
        dateQuery: null,
        clarificationQuestion: "I couldn't read that cleanly. Do you want a demo, a leaderboard, a prediction, or the score?"
      };
    }
  }
}

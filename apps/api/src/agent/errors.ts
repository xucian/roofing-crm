import type { AgentUnavailableReason } from '@roofing-crm/shared';

/**
 * The agent cannot take a turn now (503 with its reason): the day's budget is used up, the model is
 * not available to this account, or Bedrock failed several turns in a row. Kept apart from the agent's
 * modules so the router, which the `leads` function bundles too, never imports the AI SDK.
 */
export class AgentUnavailable extends Error {
  override readonly name = 'AgentUnavailable';
  constructor(readonly reason: AgentUnavailableReason) {
    super(
      reason === 'budget_exhausted'
        ? "The assistant's daily budget is used up; it answers again after 00:00 UTC."
        : reason === 'model_unavailable'
          ? 'The model is not available to this AWS account right now.'
          : 'The model failed several turns in a row; the assistant pauses for 30 seconds.',
    );
  }
}

// main/modules/hello.js

/**
 * Simple helper module just to prove ES modules are wired correctly.
 * Later we can remove or repurpose this, but for Phase 0
 * it confirms imports and DOM wiring work.
 */

/**
 * Returns a short greeting string with a timestamp.
 */
export function forgeGreeting() {
  const now = new Date();
  const time = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `🔥 ForgeAI says hello at ${time}. Ready to plan some heats.`;
}

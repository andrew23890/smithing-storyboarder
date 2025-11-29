// main/main.js
// Entry point for the Smithing Storyboarder app.

import { forgeGreeting } from "./modules/hello.js";

function setupHelloButton() {
  const button = document.getElementById("hello-button");
  const output = document.getElementById("hello-output");

  if (!button || !output) {
    console.error("Hello button or output element not found in DOM.");
    return;
  }

  button.addEventListener("click", () => {
    const message = forgeGreeting();
    output.textContent = message;
    console.log(message); // For your dev sanity check.
  });
}

function initApp() {
  console.log("Smithing Storyboarder booting up…");
  setupHelloButton();
  // Future: initialize app state, bind other UI, etc.
}

document.addEventListener("DOMContentLoaded", initApp);

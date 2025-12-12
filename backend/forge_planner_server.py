# backend/forge_planner_server.py
#
# Tiny local backend for Smithing Storyboarder Phase 8.
#
# Responsibilities:
# - Receive planner payload from plannerLLM.js:
#     { spec, schema, context }
# - Call local Ollama (Llama 3.1) at http://localhost:11434/api/generate
# - Ask it to return JSON of the form:
#     { "steps": [...], "notes": "..." }
# - Clean / validate / fall back safely.
#
# This file does NOT modify your frontend at all. It just exposes
# an HTTP endpoint for plannerLLM.js to talk to:
#
#   POST http://localhost:3000/forge-plan
#
# Make sure Ollama is running and llama3.1 is pulled:
#   ollama pull llama3.1
#   ollama serve
#
# Then start this server:
#   python forge_planner_server.py

import json
import logging
from typing import Any, Dict

from flask import Flask, request, jsonify, make_response
import requests

# ------------------------ Config knobs ------------------------

# Where Ollama is listening
OLLAMA_URL = "http://localhost:11434/api/generate"

# Which local model to use
OLLAMA_MODEL = "llama3.1"  # change if you use a different tag

# How verbose the LLM should be. Lower = more deterministic.
LLM_TEMPERATURE = 0.2

# Max tokens-ish; Ollama interprets this depending on model.
MAX_TOKENS = 1024

# Flask app
app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("forge_planner_backend")


# ------------------------ Helpers ------------------------


def build_llm_prompt(spec: str, schema: Dict[str, Any], context: Dict[str, Any]) -> str:
    """
    Build a single-string prompt for Llama 3.1 based on:
      - INTERNAL_PLANNER_SPEC (spec)
      - schema bundle (operation enums + param schemas)
      - plannerContext (starting stock, target, etc.)

    We tell the model explicitly:
      - Use the schema to pick operationType + params
      - Return ONLY JSON (no markdown, no text)
    """
    schema_json = json.dumps(schema, indent=2, sort_keys=True)
    context_json = json.dumps(context, indent=2, sort_keys=True)

    prompt = (
        spec.strip()
        + "\n\n"
        "You are now running inside a local planning backend.\n"
        "You are given the planner schema and context as JSON.\n"
        "Use them to generate a SHORT sequence of forging operations.\n\n"
        "SCHEMA (operations + paramSchemas + extras):\n"
        f"{schema_json}\n\n"
        "PLANNER CONTEXT:\n"
        f"{context_json}\n\n"
        "Output requirements:\n"
        "1. Respond with a single JSON object only. No prose, no markdown, no backticks.\n"
        '2. Shape MUST be:\n'
        '   { "steps": [ { "operationType": string, "params": object } ],\n'
        '     "notes": "optional string" }\n'
        "3. For each step:\n"
        "   - operationType must be one of the known operation ids from schema.operations.\n"
        "   - params keys must come from the canonical paramSchemas for that operation,\n"
        "     plus generic fields like lengthRegion, location, distanceFromEnd,\n"
        "     volumeDeltaOverride, description.\n"
        "4. Use 3–12 steps if possible. Prefer simple, beginner-friendly plans.\n"
        "5. Keep net volume close to the target volume. Small conservative loss is OK.\n"
        "\n"
        "Return ONLY the JSON object. Do NOT wrap it in ```json``` or any other text."
    )

    return prompt


def strip_code_fences(text: str) -> str:
    """Remove ```json ... ``` or ``` ... ``` wrappers if the model adds them."""
    if not text:
        return text

    stripped = text.strip()

    if stripped.startswith("```"):
        # Remove first line (``` or ```json)
        lines = stripped.splitlines()
        if len(lines) >= 2 and lines[0].startswith("```"):
            lines = lines[1:]
            # Drop trailing ``` if present
            if lines and lines[-1].strip().startswith("```"):
                lines = lines[:-1]
            stripped = "\n".join(lines).strip()

    return stripped


def safe_parse_llm_json(raw_text: str) -> Dict[str, Any]:
    """
    Try to parse the LLM's output as JSON.
    On failure, return a minimal empty-plan object with a diagnostic note.
    """
    cleaned = strip_code_fences(raw_text)

    try:
        data = json.loads(cleaned)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to parse LLM JSON output: %s", exc)
        return {
            "steps": [],
            "notes": "LLM output was not valid JSON; falling back to empty plan.",
        }

    # Ensure required keys exist with reasonable defaults
    if "steps" not in data or not isinstance(data["steps"], list):
        data["steps"] = []

    if "notes" in data and not isinstance(data["notes"], str):
        data["notes"] = str(data["notes"])
    elif "notes" not in data:
        data["notes"] = ""

    return data


def make_cors_response(payload, status=200):
    """Attach permissive CORS headers so the browser can call this from main/."""
    resp = make_response(jsonify(payload), status)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return resp


# ------------------------ Routes ------------------------


@app.route("/forge-plan", methods=["POST", "OPTIONS"])
def forge_plan():
    """
    Main endpoint called by plannerLLM.js.

    Expects JSON body:
      {
        "spec": "...INTERNAL_PLANNER_SPEC...",
        "schema": { ... },
        "context": { ... }
      }

    Returns JSON:
      {
        "steps": [ { "operationType": "...", "params": { ... } }, ... ],
        "notes": "optional string"
      }
    """
    if request.method == "OPTIONS":
        # CORS preflight
        return make_cors_response({}, status=204)

    try:
        payload = request.get_json(force=True, silent=False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Invalid JSON from frontend: %s", exc)
        return make_cors_response(
            {
                "steps": [],
                "notes": "Backend received invalid JSON from frontend.",
            },
            status=400,
        )

    spec = payload.get("spec") or ""
    schema = payload.get("schema") or {}
    context = payload.get("context") or {}

    if not isinstance(schema, dict):
        schema = {}
    if not isinstance(context, dict):
        context = {}

    logger.info(
        "Received planner request: has_spec=%s, schema_keys=%d",
        bool(spec),
        len(schema.keys()),
    )

    # Build the prompt for Llama 3.1
    prompt = build_llm_prompt(spec, schema, context)

    # Call Ollama /api/generate
    ollama_body = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": LLM_TEMPERATURE,
            "num_predict": MAX_TOKENS,
        },
    }

    try:
        ollama_resp = requests.post(
            OLLAMA_URL, json=ollama_body, timeout=120
        )
    except requests.RequestException as exc:
        logger.warning("Error calling Ollama: %s", exc)
        return make_cors_response(
            {
                "steps": [],
                "notes": "Local LLM server unavailable; use heuristic planner.",
            },
            status=502,
        )

    if not ollama_resp.ok:
        logger.warning(
            "Ollama returned non-OK status: %s %s",
            ollama_resp.status_code,
            ollama_resp.text[:200],
        )
        return make_cors_response(
            {
                "steps": [],
                "notes": "Local LLM returned an error; use heuristic planner.",
            },
            status=502,
        )

    try:
        ollama_json = ollama_resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to parse Ollama JSON: %s", exc)
        return make_cors_response(
            {
                "steps": [],
                "notes": "Local LLM responded with invalid JSON; using empty plan.",
            },
            status=502,
        )

    # Ollama /api/generate with stream=false typically returns a "response" field
    raw_output = ollama_json.get("response", "")
    plan = safe_parse_llm_json(raw_output)

    return make_cors_response(plan, status=200)


@app.after_request
def add_cors_headers(response):
    """Ensure CORS headers on all responses."""
    response.headers.setdefault("Access-Control-Allow-Origin", "*")
    response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type")
    response.headers.setdefault("Access-Control-Allow-Methods", "POST, OPTIONS")
    return response


if __name__ == "__main__":
    # Run the server on http://localhost:3000
    logger.info("Starting Forge planner backend on http://localhost:3000/forge-plan")
    app.run(host="127.0.0.1", port=3000, debug=True)

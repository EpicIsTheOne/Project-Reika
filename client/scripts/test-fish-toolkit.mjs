import assert from "node:assert/strict";
import { tagTtsText } from "fish-audio-tts-toolkit/src/tagging.js";
import { buildDirectFishTtsSettings, buildFishTtsPayload } from "fish-audio-tts-toolkit/src/fish.js";

const tagged = await tagTtsText({ text: "*she lowers her voice* I am glad you made it. **Do not** read `code` or https://example.com aloud." });
assert.ok(tagged.spokenText.includes("I am glad you made it"));
assert.ok(tagged.taggedText.length >= tagged.spokenText.length);
assert.ok(Array.isArray(tagged.tags));

const settings = buildDirectFishTtsSettings({ voiceId: "contract-reference-id" });
const payload = buildFishTtsPayload({ text: tagged.taggedText, settings });
assert.equal(payload.reference_id, "contract-reference-id");
assert.equal(payload.text, tagged.taggedText);
console.log("pinned Fish toolkit adapter contracts passed");

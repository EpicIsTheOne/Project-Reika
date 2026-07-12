import assert from "node:assert/strict";
import { excludeLocallyObservedRelayRecords, mergeLocalAndRelayPresence } from "../src/domain/presence.js";

const local = [{ id: "this-pc", status: "online", source: "local" }];
const relay = [
  { id: "this-pc", status: "offline", source: "relay" },
  { id: "remote-pc", status: "online", source: "relay" }
];

assert.deepEqual(mergeLocalAndRelayPresence(local, relay), [local[0], relay[1]], "live local presence must replace a stale relay copy");
assert.deepEqual(
  excludeLocallyObservedRelayRecords(local, relay.map((device) => ({ device }))),
  [{ device: relay[1] }],
  "stale relay providers for the local device must not shadow direct providers"
);

console.log("presence merge regression checks passed");

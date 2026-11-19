"""Verify emeter against the unmodified official TAP-02 Python interpreter."""
import json
from pathlib import Path
from tap02_reference import load, beat, unpack, pack, encode

root = Path(__file__).resolve().parents[2]
artifact = json.loads((root / "packages/circuit/artifacts/policy-v1.json").read_text())
netlist = bytes.fromhex(artifact["netlist"][2:])
circuit = load(netlist, artifact["nIn"], artifact["nOut"])
assert circuit.n_state == 0
assert circuit.n_gates == 11
assert encode(circuit.elements) == netlist
for row in artifact["truthTable"]:
    _, outputs = beat(circuit, [], unpack(bytes.fromhex(row["inputs"][2:]), 6))
    assert "0x" + pack(outputs).hex() == row["outputs"], row
print(json.dumps({"reference": "official TAP-02 Python interpreter", "vectorsPassed": 64,
                  "gateCount": circuit.n_gates, "netlistRoundTrip": True}))

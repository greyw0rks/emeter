import { createPublicClient, erc20Abi, getAddress, http, keccak256, parseAbi } from "viem";
import type { Hex } from "viem";
import { beaconAbi, factoryAbi, processorAbi } from "@emeter/shared";
import { POLICY_V1, POLICY_V1_NETLIST_HASH, evaluateNandNetlist } from "@emeter/circuit";
import { config, DOCUMENTED_FACTORY_IMPLEMENTATION, EXPECTED_CIRCUIT_IMPLEMENTATION, FACTORY_IMPLEMENTATION_SLOT, PROCESSOR_BEACON_SLOT, xLayerChain } from "./config.js";

const transistorsAbi = parseAbi([
  "function mintPrice() view returns (uint256)", "function protocolFee() view returns (uint256)",
  "function supplyCap() view returns (uint256)", "function minted() view returns (uint256)",
  "function balanceOf(address account, uint256 id) view returns (uint256)", "function BEM() view returns (address)"
]);

export async function verifyXLayer() {
  const cfg = config();
  const clients = [cfg.rpc, cfg.secondaryRpc].map(rpc => createPublicClient({
    chain: xLayerChain, transport: http(rpc, { timeout: 15_000, retryCount: 1 })
  }));
  const heads = await Promise.all(clients.map(async client => {
    if (await client.getChainId() !== 196) throw new Error("RPC network mismatch; expected chain 196");
    return client.getBlockNumber();
  }));
  const blockNumber = heads.reduce((a, b) => a < b ? a : b);
  const reads = await Promise.all(clients.map(async client => {
    const [block, implStorage, beaconSlot, circuitImplementation, factoryCode, processorCode,
      cpuCount, sealed, registered, processorFactory, transistors, counter, tapeoutFee, deployFee, newProtocolFee, bem] = await Promise.all([
      client.getBlock({ blockNumber }),
      client.getStorageAt({ address: cfg.factory, slot: FACTORY_IMPLEMENTATION_SLOT, blockNumber }),
      client.getStorageAt({ address: cfg.processor, slot: PROCESSOR_BEACON_SLOT, blockNumber }),
      client.readContract({ address: cfg.beacon, abi: beaconAbi, functionName: "implementation", blockNumber }),
      client.getCode({ address: cfg.factory, blockNumber }), client.getCode({ address: cfg.processor, blockNumber }),
      client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: "cpuCount", blockNumber }),
      client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: "isSealed", blockNumber }),
      client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: "isCPU", args: [cfg.processor], blockNumber }),
      client.readContract({ address: cfg.processor, abi: processorAbi, functionName: "factory", blockNumber }),
      client.readContract({ address: cfg.processor, abi: processorAbi, functionName: "transistors", blockNumber }),
      client.readContract({ address: cfg.processor, abi: processorAbi, functionName: "nextId", blockNumber }),
      client.readContract({ address: cfg.processor, abi: processorAbi, functionName: "TAPEOUT_FEE", blockNumber }),
      client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: "deployFee", blockNumber }),
      client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: "protocolFee", blockNumber }),
      client.readContract({ address: cfg.factory, abi: factoryAbi, functionName: "bem", blockNumber })
    ]);
    if (!factoryCode || factoryCode === "0x" || !processorCode || processorCode === "0x" || !implStorage || !beaconSlot) {
      throw new Error("Missing live contract code or deployment slots");
    }
    const factoryImplementation = getAddress("0x" + implStorage.slice(-40));
    const processorBeacon = getAddress("0x" + beaconSlot.slice(-40));
    if (!registered || processorFactory.toLowerCase() !== cfg.factory.toLowerCase() || processorBeacon.toLowerCase() !== cfg.beacon.toLowerCase()) {
      throw new Error("Processor is not bound to the reviewed TapeOut deployment");
    }
    if (circuitImplementation.toLowerCase() !== EXPECTED_CIRCUIT_IMPLEMENTATION.toLowerCase()) {
      throw new Error("Circuit implementation changed; review it before deployment");
    }
    const implementationCode = await client.getCode({ address: circuitImplementation, blockNumber });
    if (!implementationCode || implementationCode === "0x") throw new Error("Missing circuit implementation");
    const [mintPrice, protocolFee, supplyCap, minted, heldNand] = await Promise.all([
      client.readContract({ address: transistors, abi: transistorsAbi, functionName: "mintPrice", blockNumber }),
      client.readContract({ address: transistors, abi: transistorsAbi, functionName: "protocolFee", blockNumber }),
      client.readContract({ address: transistors, abi: transistorsAbi, functionName: "supplyCap", blockNumber }),
      client.readContract({ address: transistors, abi: transistorsAbi, functionName: "minted", blockNumber }),
      client.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [cfg.deployer, 0n], blockNumber })
    ]);
    let transistorBem: string | null = null;
    try { transistorBem = await client.readContract({ address: transistors, abi: transistorsAbi, functionName: "BEM", blockNumber }); }
    catch (error) {
      // Only a contract execution revert means a legacy implementation has no
      // BEM getter. Transport/read failures must not be turned into fee guesses.
      const message = error instanceof Error ? error.message : "";
      if (!/revert/i.test(message)) throw new Error("Transistor fee currency unavailable");
    }
    const neededNand = heldNand >= BigInt(POLICY_V1.gateCount) ? 0n : BigInt(POLICY_V1.gateCount) - heldNand;
    if (supplyCap - minted < neededNand) throw new Error("Not enough transistor supply to publish policy");
    const mintCost = neededNand === 0n ? 0n : mintPrice * neededNand + protocolFee;
    const feeInBem = transistorBem !== null && !/^0x0{40}$/i.test(transistorBem);
    const [deployerBalance, bemDecimals] = await Promise.all([
      client.getBalance({ address: cfg.deployer, blockNumber }),
      client.readContract({ address: bem, abi: erc20Abi, functionName: "decimals", blockNumber })
    ]);
    let sample: object | null = null;
    if (counter > 0n) {
      const id = 1n;
      const info = await client.readContract({ address: cfg.processor, abi: processorAbi, functionName: "circuitInfo", args: [id], blockNumber });
      const netlist = await client.readContract({ address: cfg.processor, abi: processorAbi, functionName: "netlist", args: [id], blockNumber });
      if (info[2] === 0 && info[0] <= 8) {
        let checked = 0;
        for (let mask = 0; mask < 2 ** info[0]; mask++) {
          const input = ("0x" + mask.toString(16).padStart(2, "0")) as Hex;
          let expected: Hex;
          try { expected = evaluateNandNetlist(netlist, info[0], info[1], input); }
          catch { break; }
          const actual = await client.readContract({ address: cfg.processor, abi: processorAbi, functionName: "eval", args: [id, input], blockNumber });
          if (actual !== expected) throw new Error("Live processor disagrees with TAP-02 NAND semantics");
          checked++;
        }
        sample = { circuitId: id.toString(), info, netlistHash: keccak256(netlist), checkedInputs: checked, allInputsVerified: checked === 2 ** info[0] };
      }
    }
    return {
      blockNumber: blockNumber.toString(), blockHash: block.hash, timestamp: block.timestamp.toString(),
      factory: { address: cfg.factory, implementation: factoryImplementation, implementationDiffersFromDraft: factoryImplementation.toLowerCase() !== DOCUMENTED_FACTORY_IMPLEMENTATION.toLowerCase(), codeHash: keccak256(factoryCode), cpuCount: cpuCount.toString(), sealed, currentFeeToken: bem, currentFeeDecimals: bemDecimals, newProcessorFee: deployFee.toString(), newMintProtocolFee: newProtocolFee.toString() },
      beacon: { address: cfg.beacon, implementation: circuitImplementation, implementationCodeHash: keccak256(implementationCode) },
      processor: { address: cfg.processor, codeHash: keccak256(processorCode), factory: processorFactory, beacon: processorBeacon, transistors, nextIdCounter: counter.toString(), remainingSupply: (supplyCap - minted).toString(), feeCurrency: feeInBem ? "BEM" : "legacy-native-OKB", mintPrice: mintPrice.toString(), mintProtocolFee: protocolFee.toString(), tapeoutFee: tapeoutFee.toString(), heldNand: heldNand.toString(), neededNand: neededNand.toString(), mintCost: mintCost.toString(), nativeProtocolCost: (tapeoutFee + (feeInBem ? 0n : mintCost)).toString() },
      deployer: { address: cfg.deployer, nativeBalanceWei: deployerBalance.toString() },
      sampleExistingCircuit: sample
    };
  }));
  if (JSON.stringify(reads[0]) !== JSON.stringify(reads[1])) throw new Error("Independent X Layer RPCs disagree");
  return {
    kind: "mainnet-read-only" as const, checkedAt: new Date().toISOString(), chainId: 196,
    rpcOperators: [new URL(cfg.rpc).hostname, new URL(cfg.secondaryRpc).hostname],
    independentRpcAgreement: true,
    ...reads[0]!,
    emeterPolicy: { netlistHash: POLICY_V1_NETLIST_HASH, nIn: 6, nOut: 1, nState: 0, gateCount: 11 },
    emeterMainnetCircuitId: process.env.TAPEOUT_CIRCUIT_ID || null,
    mainnetBroadcastPerformed: false
  };
}

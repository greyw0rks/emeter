// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {EmeterPolicyAdapter} from "../src/EmeterPolicyAdapter.sol";
import {EmeterProofVault} from "../src/EmeterProofVault.sol";
import {Tap13Receipt} from "../src/Tap13Receipt.sol";
import {EmeterPolicyV1} from "../src/generated/EmeterPolicyV1.sol";
import {ITapeOutFactory, ITapeOutProcessor, ITapeOutTransistors, ICircuitBeacon} from "../src/interfaces/ITapeOut.sol";

interface IContainerOpener {
    function accountOf(address circuits, uint256 id) external view returns (address);
}

/// @dev All mutations here occur on a local Foundry fork. No mainnet broadcast.
contract XLayerForkTest is Test {
    address internal constant FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address internal constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address internal constant EXISTING_PROCESSOR = 0x67be9042961344ccd387b04C24747B0c6C6D2212;
    address internal constant OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;
    bytes32 internal constant BEACON_SLOT =
        0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;
    uint256 internal circuitId;
    uint256 internal pinnedBlock;
    EmeterPolicyAdapter internal adapter;
    EmeterProofVault internal vault;
    DemoUSD internal token;
    address internal customer;
    uint256 internal customerKey;
    address internal signer;
    uint256 internal signerKey;
    address internal provider;
    address internal container;
    bytes32 internal serviceId;

    function setUp() public {
        string memory rpc = vm.envOr("X_LAYER_RPC_URL", string("https://rpc.xlayer.tech"));
        uint256 blockNumber = vm.envOr("X_LAYER_FORK_BLOCK", uint256(0));
        if (blockNumber == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNumber);
        assertEq(block.chainid, 196);
        pinnedBlock = block.number;
        assertTrue(ITapeOutFactory(FACTORY).isCPU(EXISTING_PROCESSOR));
        assertEq(ITapeOutProcessor(EXISTING_PROCESSOR).factory(), FACTORY);
        assertEq(address(uint160(uint256(vm.load(EXISTING_PROCESSOR, BEACON_SLOT)))), BEACON);
        assertEq(ICircuitBeacon(BEACON).implementation(), 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2);

        (customer, customerKey) = makeAddrAndKey("emeter-fork-customer");
        (signer, signerKey) = makeAddrAndKey("emeter-fork-provider");
        provider = makeAddr("emeter-fork-payout");
        serviceId = keccak256("emeter-protocol-proof");
        vm.deal(customer, 1 ether); // Local fake OKB only.
        ITapeOutProcessor cpu = ITapeOutProcessor(EXISTING_PROCESSOR);
        ITapeOutTransistors transistors = ITapeOutTransistors(cpu.transistors());
        assertGe(transistors.supplyCap() - transistors.minted(), 11);
        uint256 mintCost = transistors.mintPrice() * 11 + transistors.protocolFee();
        uint256 tapeoutFee = cpu.TAPEOUT_FEE();
        assertLe(mintCost + tapeoutFee, 0.01 ether);
        vm.startPrank(customer);
        transistors.mint{value: mintCost}(0, 11);
        assertEq(transistors.balanceOf(customer, 0), 11);
        circuitId = cpu.tapeout{value: tapeoutFee}(EmeterPolicyV1.netlist(), 6, 1);
        vm.stopPrank();
        assertGt(circuitId, 0);
        assertEq(transistors.balanceOf(customer, 0), 0);

        adapter = new EmeterPolicyAdapter(FACTORY, EXISTING_PROCESSOR, circuitId, BEACON);
        container = IContainerOpener(OPENER).accountOf(EXISTING_PROCESSOR, circuitId);
        token = new DemoUSD(address(this));
        token.mint(customer, 1_000_000);
        vault = new EmeterProofVault(token, adapter, EmeterProofVault.Configuration({
            customer: customer, provider: provider, providerSigner: signer, serviceContainer: container,
            serviceId: serviceId, price: 50_000, hardBudget: 200_000, softLimit: 50_000,
            expiresAt: uint64(block.timestamp + 600), settlementWindow: 300
        }));
        vm.startPrank(customer);
        token.approve(address(vault), 200_000);
        vault.deposit(200_000);
        vm.stopPrank();
    }

    function testLiveProcessorAcceptsPublishedNetlistAndFullTruthTable() public view {
        assertEq(ITapeOutProcessor(EXISTING_PROCESSOR).netlist(circuitId), EmeterPolicyV1.netlist());
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) =
            ITapeOutProcessor(EXISTING_PROCESSOR).circuitInfo(circuitId);
        assertEq(nIn, 6);
        assertEq(nOut, 1);
        assertEq(nState, 0);
        assertEq(gates, 11);
        for (uint8 inputs; inputs < 64; ++inputs) {
            bool expected = inputs & 15 == 15 && inputs & 48 != 0;
            bytes memory output = ITapeOutProcessor(EXISTING_PROCESSOR).eval(circuitId, abi.encodePacked(inputs));
            assertEq(output.length, 1);
            assertEq(uint8(output[0]), expected ? 1 : 0);
            assertEq(adapter.isAllowed(inputs), expected);
        }
    }

    function testRealCircuitGatesSettlementAndDeniesSoftOverspend() public {
        _settle(1, false);
        assertEq(token.balanceOf(provider), 50_000);
        _settleDenied(2);
        assertEq(token.balanceOf(provider), 50_000);
        assertEq(vault.spent(), 50_000);
        assertEq(vault.balance(), 150_000);
        assertFalse(vault.consumedNonces(2));
        _settle(2, true);
        assertEq(token.balanceOf(provider), 100_000);
        assertEq(vault.balance(), 100_000);
    }

    function testRealCircuitPaymentAndLockedRefundConserveDemoTokens() public {
        _settle(1, false);
        vm.prank(customer);
        vm.expectRevert(EmeterProofVault.RefundLocked.selector);
        vault.refund();
        vm.warp(vault.refundAfter());
        vm.prank(customer);
        vault.refund();
        assertEq(token.balanceOf(customer), 950_000);
        assertEq(token.balanceOf(provider), 50_000);
        assertEq(vault.balance(), 0);
    }

    function _evidence(uint256 nonce, bool overrideLimit) internal view returns (
        EmeterProofVault.ChargeAuthorization memory auth, bytes memory customerSignature,
        Tap13Receipt.Receipt memory receipt, bytes memory providerSignature
    ) {
        auth = EmeterProofVault.ChargeAuthorization({
            requestId: keccak256(abi.encode("emeter fork request", nonce)),
            requestHash: keccak256(abi.encode("emeter canonical request", nonce)),
            serviceId: serviceId, maxAmount: 50_000, nonce: nonce,
            validUntil: vault.refundAfter(), overrideSoftLimit: overrideLimit
        });
        receipt = Tap13Receipt.Receipt({
            requestId: auth.requestId, requestHash: auth.requestHash, bodyHash: keccak256("fork test result"),
            timestamp: uint64(block.timestamp), ok: true
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(customerKey, vault.authorizationDigest(auth));
        customerSignature = abi.encodePacked(r, s, v);
        bytes32 receiptDigest = keccak256(abi.encodePacked(
            "TAPI-1/resp/v2", container, receipt.requestId, receipt.requestHash,
            bytes1(0x01), receipt.bodyHash, receipt.timestamp
        ));
        (v, r, s) = vm.sign(signerKey, MessageHashUtils.toEthSignedMessageHash(receiptDigest));
        providerSignature = abi.encodePacked(r, s, v);
    }

    function _settle(uint256 nonce, bool overrideLimit) internal {
        (EmeterProofVault.ChargeAuthorization memory auth, bytes memory authSig,
            Tap13Receipt.Receipt memory receipt, bytes memory receiptSig) = _evidence(nonce, overrideLimit);
        vault.settle(auth, authSig, receipt, receiptSig);
    }

    function _settleDenied(uint256 nonce) internal {
        (EmeterProofVault.ChargeAuthorization memory auth, bytes memory authSig,
            Tap13Receipt.Receipt memory receipt, bytes memory receiptSig) = _evidence(nonce, false);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(15)));
        vault.settle(auth, authSig, receipt, receiptSig);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITapeOutFactory {
    function cpuCount() external view returns (uint256);
    function cpuAt(uint256 index) external view returns (address);
    function isCPU(address processor) external view returns (bool);
    function isSealed() external view returns (bool);
    function deployFee() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function bem() external view returns (address);
    function createCPU(
        string calldata name,
        string calldata symbol,
        string calldata story,
        uint256 supply,
        uint256 mintPrice
    ) external payable returns (address transistors, address circuits);
}

interface ITapeOutProcessor {
    function factory() external view returns (address);
    function transistors() external view returns (address);
    function nextId() external view returns (uint256);
    function TAPEOUT_FEE() external view returns (uint256);
    function circuitInfo(uint256 id)
        external
        view
        returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory outputs);
    function tapeout(bytes calldata netlistBytes, uint32 nIn, uint32 nOut)
        external
        payable
        returns (uint256 id);
}

interface ITapeOutTransistors {
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function supplyCap() external view returns (uint256);
    function minted() external view returns (uint256);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function mint(uint256 id, uint256 amount) external payable;
}

interface ICircuitBeacon {
    function implementation() external view returns (address);
}

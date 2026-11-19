// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Provider allowlist and immutable, versioned per-request payment terms.
/// Endpoint/manifest verification belongs to the gateway; a metadata hash alone
/// does not assert a live endpoint or TAP-11 resolution.
contract EmeterRegistry is Ownable2Step {
    error ProviderNotAllowed();
    error UnauthorizedProvider();
    error InvalidService();
    error ServiceAlreadyExists();
    error UnknownService();
    error UnknownVersion();

    struct Service {
        address provider;
        bool enabled;
        uint32 latestVersion;
    }

    struct PriceVersion {
        address payout;
        address signer;
        address container;
        uint256 price;
        bytes32 metadataHash;
        uint64 createdAt;
        bool enabled;
    }

    mapping(address => bool) public providerAllowed;
    mapping(bytes32 => Service) private _services;
    mapping(bytes32 => mapping(uint32 => PriceVersion)) private _versions;
    bytes32[] private _serviceIds;

    event ProviderAllowed(address indexed provider, bool allowed);
    event ServiceRegistered(bytes32 indexed serviceId, address indexed provider, uint32 version);
    event PriceVersionPublished(
        bytes32 indexed serviceId, uint32 indexed version, address payout,
        address signer, address container, uint256 price, bytes32 metadataHash
    );
    event ServiceEnabled(bytes32 indexed serviceId, bool enabled);
    event VersionEnabled(bytes32 indexed serviceId, uint32 indexed version, bool enabled);

    constructor(address administrator) Ownable(administrator) {}

    function setProviderAllowed(address provider, bool allowed) external onlyOwner {
        if (provider == address(0)) revert InvalidService();
        providerAllowed[provider] = allowed;
        emit ProviderAllowed(provider, allowed);
    }

    function registerService(
        bytes32 serviceId,
        address payout,
        address signer,
        address container,
        uint256 price,
        bytes32 metadataHash
    ) external returns (uint32 version) {
        if (!providerAllowed[msg.sender]) revert ProviderNotAllowed();
        if (_services[serviceId].provider != address(0)) revert ServiceAlreadyExists();
        if (serviceId == bytes32(0)) revert InvalidService();
        _services[serviceId] = Service(msg.sender, true, 0);
        _serviceIds.push(serviceId);
        version = _publishVersion(serviceId, payout, signer, container, price, metadataHash);
        emit ServiceRegistered(serviceId, msg.sender, version);
    }

    function publishPriceVersion(
        bytes32 serviceId,
        address payout,
        address signer,
        address container,
        uint256 price,
        bytes32 metadataHash
    ) external returns (uint32 version) {
        Service storage service = _services[serviceId];
        if (service.provider == address(0)) revert UnknownService();
        if (service.provider != msg.sender) revert UnauthorizedProvider();
        if (!providerAllowed[msg.sender]) revert ProviderNotAllowed();
        return _publishVersion(serviceId, payout, signer, container, price, metadataHash);
    }

    function _publishVersion(
        bytes32 serviceId,
        address payout,
        address signer,
        address container,
        uint256 price,
        bytes32 metadataHash
    ) private returns (uint32 version) {
        if (payout == address(0) || signer == address(0) || container == address(0)
            || price == 0 || metadataHash == bytes32(0)) revert InvalidService();
        version = ++_services[serviceId].latestVersion;
        _versions[serviceId][version] = PriceVersion(
            payout, signer, container, price, metadataHash, uint64(block.timestamp), true
        );
        emit PriceVersionPublished(serviceId, version, payout, signer, container, price, metadataHash);
    }

    function setServiceEnabled(bytes32 serviceId, bool enabled) external {
        Service storage service = _services[serviceId];
        if (service.provider == address(0)) revert UnknownService();
        if (msg.sender != service.provider && msg.sender != owner()) revert UnauthorizedProvider();
        service.enabled = enabled;
        emit ServiceEnabled(serviceId, enabled);
    }

    /// Revokes a compromised signer/version without rewriting its recorded terms.
    function setVersionEnabled(bytes32 serviceId, uint32 version, bool enabled) external {
        Service storage service = _services[serviceId];
        if (service.provider == address(0)) revert UnknownService();
        if (msg.sender != service.provider && msg.sender != owner()) revert UnauthorizedProvider();
        if (_versions[serviceId][version].price == 0) revert UnknownVersion();
        _versions[serviceId][version].enabled = enabled;
        emit VersionEnabled(serviceId, version, enabled);
    }

    function getService(bytes32 serviceId) external view returns (Service memory) {
        if (_services[serviceId].provider == address(0)) revert UnknownService();
        return _services[serviceId];
    }

    function getPriceVersion(bytes32 serviceId, uint32 version) external view returns (PriceVersion memory) {
        if (_versions[serviceId][version].price == 0) revert UnknownVersion();
        return _versions[serviceId][version];
    }

    function isServiceAuthorized(bytes32 serviceId, uint32 version) public view returns (bool) {
        Service storage service = _services[serviceId];
        return service.provider != address(0) && providerAllowed[service.provider]
            && service.enabled && _versions[serviceId][version].enabled;
    }

    function serviceCount() external view returns (uint256) { return _serviceIds.length; }
    function serviceIdAt(uint256 index) external view returns (bytes32) { return _serviceIds[index]; }
}

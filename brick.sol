/*
SPDX-License-Identifier: MIT
*/

pragma solidity >=0.6.0;

contract Brick {
    enum BrickPhase {
        Constructed, AliceFunded, BobFunded,
        Open, Cancelled, Closed
    }
    struct ChannelState {
        uint256 aliceValue;
        uint256 bobValue;
        uint256 autoIncrement;
    }
    struct ECSignature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct BlindedState {
        bytes32 stateHash;
        uint256 autoIncrement;
        ECSignature aliceSig;
        ECSignature bobSig;
    }
    struct FraudProof {
        BlindedState blindedState;
        ECSignature watchtowerSig;
        uint256 watchtowerIdx;
    }

    uint256 constant n = 13;
    uint256 constant t = 10;
    uint256 constant FEE = 2 wei; // must be even
    uint256 _f;
    address payable _alice;
    address payable _bob;
    address payable[n] _watchtowers;
    BrickPhase phase = BrickPhase.Constructed;
    ChannelState initialState;
    bool[n] _watchtowerFunded;
    uint256 collateral = 0;
    bool _bobFunded = false;
    bool _aliceRecovered = false;
    bool _bobRecovered = false;

    BlindedState[n] _watchtowerLastClaim;
    BlindedState _bestClaimedState;
    bool[n] _watchtowerClaimedClose;
    uint256 _numWatchtowerClaims = 0;
    uint256 _maxWatchtowerAutoIncrementClaim = 0;
    bool _aliceWantsClose = false;
    ChannelState _aliceClaimedClosingState;

    function ceil(uint a, uint m) internal pure returns (uint) {
        return ((a + m - 1) / m) * m;
    }

    modifier atPhase(BrickPhase _phase) {
        require(phase == _phase);
        _;
    }

    modifier aliceOnly() {
        require(msg.sender == _alice);
        _;
    }

    modifier bobOnly() {
        require(msg.sender == _bob);
        _;
    }

    modifier openOnly() {
        require(phase == BrickPhase.Open);
        _;
    }

    function init(address payable bob, address[n] memory watchtowers) public payable
        atPhase(BrickPhase.Constructed) {
        // TODO: watchtower privacy
        // This requirement is needed to ensure watchtowers are not
        // held hostage. If this requirement is not needed, the contract
        // works even with n = 0.
        assert(n > 7);
        // Floor
        _f = (n - 1) / 3;
        assert(t <= n && t >= 2*_f + 1);

        require(msg.value >= FEE / 2);
        _alice = msg.sender;
        initialState.aliceValue = msg.value - FEE / 2;
        _bob = bob;
        _watchtowers = watchtowers;
        phase = BrickPhase.AliceFunded;
    }

    function fundBob() public payable
        atPhase(BrickPhase.AliceFunded) bobOnly {
        // todo: make channel updatable while it is open
        require(!_bobFunded);
        require(msg.value >= FEE / 2);
        initialState.bobValue = msg.value - FEE / 2;
        _bobFunded = true;
        // TODO: Check that ceil here is incentive-compatible for watchtower hostage situation
        collateral = ceil(initialState.aliceValue + initialState.bobValue, _f);
        phase = BrickPhase.BobFunded;
    }

    function fundWatchtower(uint256 idx) public payable
        atPhase(BrickPhase.BobFunded) {
        require(_watchtowers[idx] == msg.sender);
        require(msg.value >= collateral);
        _watchtowerFunded[n] = true;
    }

    function withdrawBeforeOpen(uint256 idx) public {
        uint256 amount;

        require(phase == BrickPhase.AliceFunded
             || phase == BrickPhase.BobFunded
             || phase == BrickPhase.Cancelled);

        if (msg.sender == _alice) {
            require(!_aliceRecovered);
            _aliceRecovered = true;
            amount = initialState.aliceValue + FEE / 2;
        }
        else if (msg.sender == _bob) {
            // _bobFunded remains true so that watchtowers can
            // recover collateral
            require(!_bobRecovered);
            _bobRecovered = true;
            amount = initialState.bobValue + FEE / 2;
        }
        else if (msg.sender == _watchtowers[idx]) {
            require(_watchtowerFunded[idx]);
            _watchtowerFunded[idx] = false;
            amount = collateral;
        }
        else {
            revert();
        }

        phase = BrickPhase.Cancelled;
        msg.sender.transfer(amount);
    }

    function open() public {
        // TODO: if a watchtower has not funded for a while,
        // allow the channel to open without them
        require(phase == BrickPhase.BobFunded);

        for (uint256 idx = 0; idx < n; ++idx) {
            require(_watchtowerFunded[idx]);
        }
        phase = BrickPhase.Open;
    }

    function optimisticAliceClose(ChannelState memory closingState) public
        openOnly aliceOnly {
        // Alice should stop using the channel off-chain once this
        // function is called.
        require(closingState.aliceValue + closingState.bobValue
             <= initialState.aliceValue + initialState.bobValue);
        _aliceWantsClose = true;
        _aliceClaimedClosingState = closingState;
    }

    function optimisticBobClose(ChannelState memory bobClaimedClosingState) public
        openOnly bobOnly {
        require(_aliceClaimedClosingState == bobClaimedClosingState);
        require(_aliceWantsClose);

        optimisticClose(_aliceClaimedClosingState);
    }

    function optimisticClose(ChannelState memory closingState) internal
        openOnly {
        phase = BrickPhase.Closed;
        _alice.transfer(closingState.aliceValue);
        _bob.transfer(closingState.bobValue);

        for (uint256 idx = 0; idx < n; ++idx) {
            _watchtowers[idx].transfer(collateral);
        }
    }

    function checkSig(
        address pk,
        bytes32 plaintext,
        ECSignature memory sig
    )
        internal returns(bool) {
        return ecrecover(plaintext, sig.v, sig.r, sig.s) == pk;
    }

    function validState(BlindedState memory blindedState) internal view returns(bool) {
        require(
            checkSig(
                _alice,
                blindedState.stateHash,
                blindedState.aliceSig
            )
            &&
            checkSig(
                _bob,
                blindedState.stateHash,
                blindedState.bobSig
            )
        );
    }

    function watchtowerClaimState(BlindedState memory claimedLastState, uint256 idx)
        public openOnly {
        require(validState(claimedLastState));
        require(msg.sender == _watchtowers[idx]);
        require(!_watchtowerClaimedClose[idx]);
        _watchtowerLastClaim[idx] = claimedLastState;
        _watchtowerClaimedClose[idx] = true;
        ++_numWatchtowerClaims;

        if (claimedLastState.autoIncrement > _maxWatchtowerAutoIncrementClaim) {
            _maxWatchtowerAutoIncrementClaim = claimedLastState.autoIncrement;
            _bestClaimedState = claimedLastState;
        }
    }

    function staleClaim(FraudProof memory proof) internal view returns (bool) {
        uint256 watchtowerIdx = proof.watchtowerIdx;

        return proof.blindedState.autoIncrement
               >
               _watchtowerLastClaim[watchtowerIdx].autoIncrement;
    }

    function validFraudProof(FraudProof memory proof) internal view returns (bool) {
        return checkSig(
            _watchtowers[proof.watchtowerIdx],
            proof.blindedState,
            proof.watchtowerSig
        ) && staleClaim(proof);
    }

    function counterparty(address party) internal view returns (address payable) {
        if (party == _alice) {
            return _bob;
        }
        return _alice;
    }

    function pessimisticClose(
        ChannelState memory closingState,
        FraudProof[] memory proofs
    ) public
        openOnly {
        require(msg.sender == _alice || msg.sender == _bob);
        require(_bestClaimedState.autoIncrement == closingState.autoIncrement);
        require(_numWatchtowerClaims >= 2*_f + 1);
        mapping (uint256 => bool) storage maliciousWatchtowers;

        for (uint256 i = 0; i < proofs.length; ++i) {
            uint256 idx = proofs[i].watchtowerIdx;
            require(validFraudProof(proofs[i]));
            maliciousWatchtowers[idx] = true;
        }

        phase = BrickPhase.Closed;

        if (proofs.length <= _f) {
            _alice.transfer(closingState.aliceValue);
            _bob.transfer(closingState.bobValue);
        }
        else {
            counterparty(msg.sender).transfer(
                closingState.aliceValue + closingState.bobValue
            );
        }
        msg.sender.transfer(collateral * proofs.length);
        for (uint256 idx = 0; idx < n; ++idx) {
            if (!maliciousWatchtowers[idx]) {
                _watchtowers[idx].transfer(collateral);
            }
        }
    }
}

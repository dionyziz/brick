/*
SPDX-License-Identifier: MIT
*/

pragma solidity >=0.5.16;
pragma experimental ABIEncoderV2;

library BrickBase {
    function divceil(uint a, uint m)
    internal pure returns (uint) {
        return (a + m - 1) / m;
    }
}

contract Brick {
    enum BrickPhase {
        Deployed, AliceFunded, BobFunded,
        Open, Cancelled, Closed
    }
    struct ChannelState {
        uint256 aliceValue;
        uint16 autoIncrement;
    }
    struct ECSignature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct Announcement {
        uint16 autoIncrement;
        ECSignature aliceSig;
        ECSignature bobSig;
    }
    struct FraudProof {
        Announcement statePoint;
        ECSignature watchtowerSig;
        uint8 watchtowerIdx;
    }

    mapping (uint16 => bool) announcementAutoIncrementSigned;
    uint256 public _initialAliceValue;
    uint256 public _initialBobValue;
    uint8 public _n;
    uint8 public _t;
    uint256 constant public FEE = 20 wei; // must be even
    uint8 public _f;
    address payable public _alice;
    address payable public _bob;
    address payable[] public _watchtowers;
    BrickPhase public _phase;
    bool[] public _watchtowerFunded;
    uint256 public _collateral;
    bool public _bobFunded;
    bool _aliceRecovered;
    bool _bobRecovered;

    uint16[] _watchtowerLastAutoIncrement;
    Announcement _bestAnnouncement;
    bool[] _watchtowerClaimedClose;
    uint8 _numWatchtowerClaims;
    uint16 _maxWatchtowerAutoIncrementClaim;
    bool _aliceWantsClose;
    uint256 _aliceClaimedClosingValue;
    uint8 _numHonestClosingWatchtowers;

    modifier atPhase(BrickPhase phase) {
        require(_phase == phase, 'Invalid phase');
        _;
    }

    modifier aliceOnly() {
        require(msg.sender == _alice, 'Only Alice is allowed to call that');
        _;
    }

    modifier bobOnly() {
        require(msg.sender == _bob, 'Only Bob is allowed to call that');
        _;
    }

    modifier openOnly() {
        require(_phase == BrickPhase.Open, 'Channel is not open');
        _;
    }

    function aliceFund(address payable bob, address payable[] memory watchtowers)
    public payable atPhase(BrickPhase.Deployed) {
        // TODO: watchtower privacy
        // This requirement is needed to ensure watchtowers are not
        // held hostage. If this requirement is not needed, the contract
        // works even with n = 0.
        // assert(n > 7);
        // Floor
        _n = uint8(watchtowers.length);
        _f = (_n - 1) / 3;
        _t = 2*_f + 1;
        // assert(t <= n && t >= 2*_f + 1);

        // If Alice pays less than FEE / 2, other parties should refuse to use this contract
        // but the contract does not need to check this here.
        // require(msg.value >= FEE / 2, 'Alice must pay at least the fee');
        _alice = msg.sender;
        _initialAliceValue = msg.value - FEE / 2;
        _bob = bob;
        _watchtowers = watchtowers;
        for (uint8 i = 0; i < _n; ++i) {
            _watchtowerFunded.push(false);
            _watchtowerClaimedClose.push(false);
            _watchtowerLastAutoIncrement.push(0);
        }

        _phase = BrickPhase.AliceFunded;
    }

    function fundBob() external payable atPhase(BrickPhase.AliceFunded) {
        // TODO: make channel updatable while it is open
        require(msg.value >= FEE / 2, 'Bob must pay at least the fee');
        _initialBobValue = msg.value - FEE / 2;
        _bobFunded = true;
        // TODO: Check that ceil here is incentive-compatible for watchtower hostage situation
        if (_f > 0) {
            _collateral = BrickBase.divceil(_initialAliceValue + _initialBobValue, _f);
        }
        _phase = BrickPhase.BobFunded;
    }

    function fundWatchtower(uint8 idx)
    external payable atPhase(BrickPhase.BobFunded) {
        require(msg.value >= _collateral, 'Watchtower must pay at least the collateral');
        _watchtowerFunded[idx] = true;
    }

    function withdrawBeforeOpen(uint8 idx) external {
        uint256 amount;

        require(_phase == BrickPhase.AliceFunded ||
                _phase == BrickPhase.BobFunded ||
                _phase == BrickPhase.Cancelled,
                'Withdrawals are only allowed early');

        if (msg.sender == _alice) {
            require(!_aliceRecovered, 'Alice has already withdrawn');
            _aliceRecovered = true;
            amount = _initialAliceValue + FEE / 2;
        }
        else if (msg.sender == _bob) {
            require(_bobFunded, 'Bob has already withdrawn');
            _bobFunded = false;
            amount = _initialBobValue + FEE / 2;
        }
        else if (msg.sender == _watchtowers[idx]) {
            require(_watchtowerFunded[idx], 'This watchtower has already withdrawn');
            _watchtowerFunded[idx] = false;
            amount = _collateral;
        }
        else {
            revert('Only the participants can withdraw');
        }

        _phase = BrickPhase.Cancelled;
        msg.sender.transfer(amount);
    }

    function open() external atPhase(BrickPhase.BobFunded) {
        // TODO: if a watchtower has not funded for a while,
        // allow the channel to open without them
        for (uint8 idx = 0; idx < _n; ++idx) {
            require(_watchtowerFunded[idx], 'All watchtowers must fund the channel before opening it');
        }
        _phase = BrickPhase.Open;
    }

    function optimisticAliceClose(uint256 closingAliceValue)
    public openOnly aliceOnly {
        // Alice should stop using the channel off-chain once this
        // function is called.
        require(closingAliceValue <=
                _initialAliceValue + _initialBobValue, 'Channel cannot close at a higher value than it began at');
        // Ensure Alice doesn't later change her mind about the value
        // in a malicious attempt to frontrun bob's optimisticBobClose()
        require(!_aliceWantsClose, 'Alice can only decide to close with one state');
        _aliceWantsClose = true;
        _aliceClaimedClosingValue = closingAliceValue;
    }

    function optimisticBobClose()
    public openOnly bobOnly {
        require(_aliceWantsClose, 'Bob cannot close on his own volition');

        _phase = BrickPhase.Closed;
        _alice.transfer(_aliceClaimedClosingValue + FEE / 2);
        _bob.transfer(_initialBobValue + _initialAliceValue - _aliceClaimedClosingValue + FEE / 2);

        for (uint256 idx = 0; idx < _n; ++idx) {
            _watchtowers[idx].transfer(_collateral);
        }
    }

    function watchtowerClaimState(Announcement memory announcement, uint256 idx)
    public openOnly {
        require(validAnnouncement(announcement), 'Announcement does not have valid signatures by Alice and Bob');
        require(msg.sender == _watchtowers[idx], 'This is not the watchtower claimed');
        require(!_watchtowerClaimedClose[idx], 'Each watchtower can only submit one pessimistic state');
        require(_numWatchtowerClaims < _t, 'Watchtower race is complete');

        _watchtowerLastAutoIncrement[idx] = announcement.autoIncrement;
        _watchtowerClaimedClose[idx] = true;
        ++_numWatchtowerClaims;

        if (announcement.autoIncrement > _maxWatchtowerAutoIncrementClaim) {
            _maxWatchtowerAutoIncrementClaim = announcement.autoIncrement;
            _bestAnnouncement = announcement;
        }
    }

    function pessimisticClose(ChannelState memory closingState, ECSignature memory counterpartySig, FraudProof[] memory proofs)
    public openOnly {
        require(msg.sender == _alice || msg.sender == _bob, 'Only Alice or Bob can pessimistically close the channel');
        require(_bestAnnouncement.autoIncrement == closingState.autoIncrement, 'Channel must close at latest state');
        require(closingState.aliceValue <=
                _initialAliceValue + _initialBobValue, 'Channel must conserve monetary value');
        require(_numWatchtowerClaims >= _t, 'At least 2f+1 watchtower claims are needed for pessimistic close');
        bytes32 plaintext = keccak256(abi.encode(address(this), closingState));
        require(checkPrefixedSig(counterparty(msg.sender), plaintext, counterpartySig), 'Counterparty must have signed closing state');

        for (uint256 i = 0; i < proofs.length; ++i) {
            uint256 idx = proofs[i].watchtowerIdx;
            require(validFraudProof(proofs[i]), 'Invalid fraud proof');
            // Ensure there's at most one fraud proof per watchtower
            require(_watchtowerFunded[idx], 'Duplicate fraud proof');
            _watchtowerFunded[idx] = false;
        }

        _numHonestClosingWatchtowers = _n - uint8(proofs.length);
        _phase = BrickPhase.Closed;

        if (proofs.length <= _f) {
            _alice.transfer(closingState.aliceValue);
            _bob.transfer(_initialAliceValue + _initialBobValue - closingState.aliceValue);
        }
        else {
            counterparty(msg.sender).transfer(_initialAliceValue + _initialBobValue);
        }
        msg.sender.transfer(_collateral * proofs.length);
    }

    function watchtowerRedeemCollateral(uint256 idx)
    external atPhase(BrickPhase.Closed) {
        require(msg.sender == _watchtowers[idx], 'This is not the watchtower claimed');
        require(_watchtowerFunded[idx], 'Malicious watchtower tried to redeem collateral; or double collateral redeem');

        _watchtowerFunded[idx] = false;
        _watchtowers[idx].transfer(_collateral + FEE / _numHonestClosingWatchtowers);
    }

    function checkSig(address pk, bytes32 plaintext, ECSignature memory sig)
    public pure returns(bool) {
        return ecrecover(plaintext, sig.v, sig.r, sig.s) == pk;
    }

    function checkPrefixedSig(address pk, bytes32 message, ECSignature memory sig)
    public pure returns(bool) {
        bytes32 prefixedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));

        return ecrecover(prefixedHash, sig.v, sig.r, sig.s) == pk;
    }

    function validAnnouncement(Announcement memory announcement)
    public returns(bool) {
        if (announcementAutoIncrementSigned[announcement.autoIncrement]) {
            return true;
        }
        bytes32 message = keccak256(abi.encode(address(this), announcement.autoIncrement));

        if (checkPrefixedSig(_alice, message, announcement.aliceSig) &&
            checkPrefixedSig(_bob, message, announcement.bobSig)) {
            announcementAutoIncrementSigned[announcement.autoIncrement] = true;
            return true;
        }
        return false;
    }

    function counterparty(address party)
    internal view returns (address payable) {
        if (party == _alice) {
            return _bob;
        }
        return _alice;
    }

    function staleClaim(FraudProof memory proof)
    internal view returns (bool) {
        uint256 watchtowerIdx = proof.watchtowerIdx;

        return proof.statePoint.autoIncrement >
               _watchtowerLastAutoIncrement[watchtowerIdx];
    }

    function validFraudProof(FraudProof memory proof)
    public view returns (bool) {
        return checkPrefixedSig(
            _watchtowers[proof.watchtowerIdx],
            keccak256(abi.encode(address(this), proof.statePoint.autoIncrement)),
            proof.watchtowerSig
        ) && staleClaim(proof);
    }
}

/*
const ganache = require('ganache-cli')
const json = require('./../build/contracts/Brick.json')
*/
const truffleAssert = require('truffle-assertions')

const Brick = artifacts.require('Brick')

contract('Brick', (accounts) => {
    const alice = accounts[0]
    const bob = accounts[1]
    const n = 13
    const eve = accounts[n + 3]
    const FEE = 20
    const watchtowers = []

    for (let i = 0; i < n; ++i) {
        watchtowers.push(accounts[i + 2])
    }

    const makeBrick = () =>
        Brick.new(bob, watchtowers, { value: FEE / 2 + 5 })

    const fundBob = (brick) =>
        brick.fundBob({ from: bob, value: FEE / 2 + 12 })

    const makeFundedBrick = async () => {
        const brick = await makeBrick()
        await fundBob(brick)

        for (let idx = 0; idx < n; ++idx) {
            await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
        }
        return brick
    }

    it('is constructable', async () => {
        await truffleAssert.reverts(Brick.new(bob, watchtowers), 'Alice must pay at least the fee')
        const brick = await makeBrick()

        assert.equal(await brick._alice(), alice)
        assert.equal(await brick._bob(), bob)
        for (let i = 0; i < n; ++i) {
            assert.equal(await brick._watchtowers(i), watchtowers[i])
        }
        assert.equal(await brick._f(), 4)
    })

    it('is fundable', async () => {
        const brick = await makeBrick()
        assert.equal(await brick._bobFunded(), false)
        await truffleAssert.reverts(brick.fundBob({ from: bob }), 'Bob must pay at least the fee')
        await truffleAssert.reverts(brick.fundWatchtower(0, { from: watchtowers[0] }), '', 'Watchtower cannot fund before Bob')
        await fundBob(brick)
        assert.equal(await brick._bobFunded(), true)
        const {aliceValue, bobValue, autoIncrement} = await brick._initialState()
        assert.equal(aliceValue.toNumber(), 5)
        assert.equal(bobValue.toNumber(), 12)
        assert.equal(autoIncrement.toNumber(), 0)

        await truffleAssert.reverts(brick.fundWatchtower(5, { from: watchtowers[5] }), 'Watchtower must pay at least the collateral')

        assert.equal((await brick._collateral()).toNumber(), 5)

        for (let idx = 0; idx < n; ++idx) {
            assert.equal(await brick._watchtowerFunded(idx), false)
            await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
            assert.equal(await brick._watchtowerFunded(idx), true)
        }
    })

    const assertBalanceDiff = async (expectedDiffs, operation) => {
        let balancesBefore = {}

        for (let { account } of expectedDiffs) {
            balancesBefore[account] = await web3.eth.getBalance(account)
        }

        const tx = await operation()
        const gasPrice = await web3.eth.getGasPrice()
        const gasUsed = tx.receipt.gasUsed
        const gasCost = gasUsed * gasPrice

        for (let { account, value, paysForGas } of expectedDiffs) {
            let balanceAfter = await web3.eth.getBalance(account)

            let actualDiff = web3.utils.toBN(balanceAfter)
                             .sub(web3.utils.toBN(balancesBefore[account]))
            if (paysForGas) {
                actualDiff = actualDiff.add(web3.utils.toBN(gasCost))
            }
            actualDiff = actualDiff.toNumber()
            assert.equal(actualDiff, value)
        }
    }

    it('allows early withdrawals', async () => {
        let brick = await makeBrick()
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: eve }),
            'Only the participants can withdraw'
        )
        await assertBalanceDiff(
            [{ account: alice, value: FEE / 2 + 5, paysForGas: true }],
            () => brick.withdrawBeforeOpen(0)
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: alice }),
            'Alice has already withdrawn'
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: bob }),
            'Bob has already withdrawn',
            'Bob should not be able to withdraw without depositing'
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: watchtowers[0] }),
            'This watchtower has already withdrawn',
            'A watchtower should not be able to withdraw without depositing'
        )

        brick = await makeBrick()
        await fundBob(brick)
        await assertBalanceDiff(
            [{ account: bob, value: FEE / 2 + 12, paysForGas: true }],
            () => brick.withdrawBeforeOpen(0, { from: bob })
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: bob }),
            'Bob has already withdrawn'
        )

        brick = await makeBrick()
        await fundBob(brick)
        await brick.fundWatchtower(3, { from: watchtowers[3], value: 5 })
        await brick.fundWatchtower(4, { from: watchtowers[4], value: 5 })
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: watchtowers[0] }),
            'This watchtower has already withdrawn',
            'A watchtower should not be able to withdraw without depositing, even if other watchtowers have deposited'
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(3, { from: watchtowers[0] }),
            'Only the participants can withdraw',
            'A watchtower should not be able to withdraw the money of other watchtowers'
        )
        await assertBalanceDiff(
            [{ account: watchtowers[3], value: 5, paysForGas: true }],
            () => brick.withdrawBeforeOpen(3, { from: watchtowers[3] })
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(3, { from: watchtowers[3] }),
            'This watchtower has already withdrawn'
        )
        await assertBalanceDiff(
            [{ account: watchtowers[4], value: 5, paysForGas: true }],
            () => brick.withdrawBeforeOpen(4, { from: watchtowers[4] })
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(4, { from: watchtowers[4] }),
            'This watchtower has already withdrawn'
        )
    })

    it('opens', async () => {
        const brick = await makeBrick()

        await truffleAssert.reverts(
            brick.open(), 'Invalid phase',
            'Bob must fund channel before opening'
        )
        await fundBob(brick)
        await truffleAssert.reverts(
            brick.open(),
            'watchtowers must fund the channel before opening'
        )
        await brick.fundWatchtower(0, { from: watchtowers[0], value: 5 })
        await brick.fundWatchtower(2, { from: watchtowers[2], value: 5 })
        await truffleAssert.reverts(
            brick.open(),
            'All watchtowers must fund the channel before opening'
        )

        for (let idx = 0; idx < n; ++idx) {
            if (idx != 0 && idx != 2) {
                await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
            }
        }
        await brick.open()
    })

    it('closes optimistically', async () => {
        const brick = await makeFundedBrick()

        await truffleAssert.reverts(
            brick.optimisticAliceClose({
                aliceValue: 5,
                bobValue: 12,
                autoIncrement: 1
            }),
            '', 'Should not close channel that is not open'
        )

        await brick.open()

        await truffleAssert.reverts(
            brick.optimisticBobClose({ from: bob }),
            'Bob cannot close on his own'
        )

        await truffleAssert.reverts(
            brick.optimisticAliceClose({
                aliceValue: 6,
                bobValue: 12,
                autoIncrement: 1
            }),
            'cannot close at a higher value than it began'
        )

        await brick.optimisticAliceClose({
            aliceValue: 4,
            bobValue: 13,
            autoIncrement: 1
        }),

        await assertBalanceDiff(
            [{
                account: alice,
                value: 4 + FEE / 2
            }, {
                account: bob,
                value: 13 + FEE / 2,
                paysForGas: true
            }, {
                account: watchtowers[0],
                value: 5
            }, {
                account: watchtowers[7],
                value: 5
            }],
            () => brick.optimisticBobClose({ from: bob })
        )
    })
})

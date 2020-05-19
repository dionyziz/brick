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

    const makeBrick = () => Brick.new(bob, watchtowers, { value: FEE / 2 + 5 })

    const makeFundedBrick = async () => {
        const brick = await makeBrick()
        await brick.fundBob({ from: bob, value: FEE / 2 + 12 })

        for (let idx = 0; idx < n; ++idx) {
            await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
        }
        return brick
    }

    it('is constructable', async () => {
        await truffleAssert.reverts(Brick.new(bob, watchtowers), 'Alice must pay at least the fee')
        const brick = await Brick.new(bob, watchtowers, { value: FEE / 2 })

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
        await brick.fundBob({ from: bob, value: FEE / 2 + 12 })
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

    const assertBalanceDiff = async (account, operation, expectedDiff) => {
        const balanceBefore = await web3.eth.getBalance(account)
        const tx = await operation()
        const gasPrice = await web3.eth.getGasPrice()
        const gasUsed = tx.receipt.gasUsed
        const gasCost = gasUsed * gasPrice
        const balanceAfter = await web3.eth.getBalance(account)
        const diff = web3.utils.toBN(balanceAfter).sub(web3.utils.toBN(balanceBefore)).add(web3.utils.toBN(gasCost)).toNumber()
        assert.equal(diff, expectedDiff)
    }

    it('allows early withdrawals', async () => {
        let brick = await makeBrick()
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: eve }),
            'Only the participants can withdraw'
        )
        await assertBalanceDiff(
            alice,
            () => brick.withdrawBeforeOpen(0),
            FEE / 2 + 5
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
        await brick.fundBob({ from: bob, value: FEE / 2 + 12 })
        await assertBalanceDiff(
            bob,
            () => brick.withdrawBeforeOpen(0, { from: bob }),
            FEE / 2 + 12
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: bob }),
            'Bob has already withdrawn'
        )

        brick = await makeBrick()
        await brick.fundBob({ from: bob, value: FEE / 2 + 12 })
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
            watchtowers[3],
            () => brick.withdrawBeforeOpen(3, { from: watchtowers[3] }),
            5
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(3, { from: watchtowers[3] }),
            'This watchtower has already withdrawn'
        )
        await assertBalanceDiff(
            watchtowers[4],
            () => brick.withdrawBeforeOpen(4, { from: watchtowers[4] }),
            5
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(4, { from: watchtowers[4] }),
            'This watchtower has already withdrawn'
        )
    })
})

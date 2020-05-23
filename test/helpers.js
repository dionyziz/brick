const assertBalanceDiff = async (expectedDiffs, operation) => {
    const balancesBefore = {}

    for (let { account } of expectedDiffs) {
        balancesBefore[account] = await web3.eth.getBalance(account)
    }

    const tx = await operation()
    const gasPrice = await web3.eth.getGasPrice()
    const gasUsed = tx.receipt.gasUsed
    const gasCost = gasUsed * gasPrice

    for (let { account, value, paysForGas } of expectedDiffs) {
        const balanceAfter = await web3.eth.getBalance(account)

        let actualDiff = web3.utils.toBN(balanceAfter)
                            .sub(web3.utils.toBN(balancesBefore[account]))
        if (paysForGas) {
            actualDiff = actualDiff.add(web3.utils.toBN(gasCost))
        }
        actualDiff = actualDiff.sub(web3.utils.toBN(value)).toNumber()
        assert.equal(actualDiff, 0)
    }
}

module.exports = { assertBalanceDiff }

module.exports = async (callback) => {
    try {
        console.log('Retrieving accounts')
        const accounts = await web3.eth.getAccounts()
        const Brick = artifacts.require('Brick')

        const alice = accounts[0]
        const bob = accounts[1]
        const n = 13
        const eve = accounts[n + 3]
        const FEE = 20
        const watchtowers = []

        for (let i = 0; i < n; ++i) {
            watchtowers.push(accounts[i + 2])
        }

        let openGas = 0

        console.log('Constructing brick')
        const brick = await Brick.new(bob, watchtowers, { value: FEE / 2 + 5 })
        console.log('Getting receipt')
        const receipt = await web3.eth.getTransactionReceipt(brick.transactionHash)
        console.log('Calculating gas for construction')
        const aliceFundGas = web3.utils.toBN(receipt.gasUsed)
        console.log('Gas for Alice fund: ', aliceFundGas.toString())

        let tx = await brick.fundBob({ from: bob, value: FEE / 2 + 12 })
        const bobFundGas = web3.utils.toBN(tx.receipt.gasUsed)
        console.log('Gas for Bob fund: ', bobFundGas.toString())

        let watchtowersGas = web3.utils.toBN(0)
        for (let idx = 0; idx < n; ++idx) {
            console.log('Watchtower ', idx, ' funding')
            tx = await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
            watchtowersGas = watchtowersGas.add(web3.utils.toBN(tx.receipt.gasUsed))
        }
        console.log('Gas for watchtowers: ', watchtowersGas.toNumber())

        const totalGas = aliceFundGas.add(bobFundGas).add(watchtowersGas)
        console.log('Total gas: ', totalGas.toString())
        const gasPrice = web3.utils.toBN(await web3.eth.getGasPrice())
        console.log('Gas price: ', gasPrice.toString())
        const gasCostWei = totalGas.mul(gasPrice)
        console.log('Total gas cost in wei: ', gasCostWei.toString())
        console.log('Total gas cost in ether: ', web3.utils.fromWei(gasCostWei, 'ether').toString())

        console.log('Done')

        callback()
    }
    catch (err) {
        callback(err)
    }
}

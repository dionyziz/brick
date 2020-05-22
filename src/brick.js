function offchainSign(msg, privateKey) {
    const msgHex = Buffer.from(msg, 'latin1').toString('hex')
    const msgHashHex = web3.utils.keccak256('0x' + msgHex)
    const sig = web3.eth.accounts.sign(msgHashHex, privateKey)

    let { v, r, s } = sig
    v = parseInt(v, 16)

    return { v, r, s }
}

function signState(state, privateKey) {
    const encodedMsg = hexToBytes(web3.eth.abi.encodeParameters(
        [
            'address',
            {
                ChannelState: {
                    'aliceValue': 'uint256',
                    'bobValue': 'uint256',
                    'autoIncrement': 'uint16'
                }
            }
        ],
        [
            brick.address,
            state3
        ]
    ).slice(2))

    return offchainSign(encodedMsg, privateKey)
}

function hexToBytes(hex) {
    let bytes = ''

    for (let c = 0; c < hex.length; c += 2) {
        bytes += String.fromCharCode(parseInt(hex.substr(c, 2), 16))
    }
    return bytes
}

module.exports = { offchainSign, signState, hexToBytes }

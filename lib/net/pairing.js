


export function resolveLoopbackPairs(decisions, treePids) {
  const families = new Map()
  const listeningPorts = new Set()
  for (const decision of decisions) {
    if (decision.row.netid === 'tcp' && decision.row.stateNum === 10) listeningPorts.add(String(decision.local.port))
  }
  const index = new Map()
  for (const decision of decisions) {
    if (decision.row.netid !== 'tcp' || decision.row.stateNum !== 1) continue
    const { local, remote } = decision
    if (!isLoopback(local.address) || !isLoopback(remote.address)) continue
    index.set(`${String(local.port)}|${String(remote.port)}`, decision)
  }
  let pairs = 0
  let unresolved = 0
  for (const [key, decision] of index) {
    const { local, remote } = decision

    if (listeningPorts.has(String(local.port))) continue
    const peer = index.get(`${String(remote.port)}|${String(local.port)}`)
    if (peer === undefined) {
      unresolved++
      families.set(decision.row.key, 'lan')
      continue
    }
    pairs++
    const serverIsListening = listeningPorts.has(String(peer.local.port))
    const clientOwned = decision.row.owners.some(pid => treePids.has(pid))
    if (!serverIsListening) {


      unresolved++
      families.set(decision.row.key, 'lan')
      families.set(peer.row.key, 'lan')
      continue
    }
    if (clientOwned) {
      families.set(decision.row.key, 'net-tcp')

      families.set(peer.row.key, 'lan')
      continue
    }
    if (serverIsListening) {
      families.set(decision.row.key, 'forwarded')
      families.set(peer.row.key, 'forwarded')
    }
  }
  for (const decision of decisions) {
    if (families.has(decision.row.key)) continue
    if (decision.row.netid === 'tcp' && decision.row.stateNum === 1 && isLoopback(decision.local.address) && listeningPorts.has(String(decision.local.port))) {

      unresolved++
      families.set(decision.row.key, 'forwarded')
      continue
    }
    families.set(decision.row.key, decision.family)
  }
  return { families, pairs, unresolved }
}


function isLoopback(address) {
  if (typeof address !== 'string') return false
  return address === '::1' || address === '0:0:0:0:0:0:0:1' || address.startsWith('127.')
}


export function pairLoopback(sockets, treePids) {
  const listenPorts = new Set()
  for (const socket of sockets) {
    if (socket.netid === 'tcp' && socket.stateNum === 10) listenPorts.add(String(socket.local.port))
  }
  const index = new Map()
  for (const socket of sockets) {
    if (socket.netid !== 'tcp' || socket.stateNum !== 1) continue
    if (!isLoopback(socket.local.address) || !isLoopback(socket.remote.address)) continue
    index.set(`${String(socket.local.port)}|${String(socket.remote.port)}`, socket)
  }
  const pairs = []
  const bySocket = new Map()
  const seen = new Set()
  for (const [key, client] of index) {
    if (seen.has(client.key)) continue
    if (listenPorts.has(String(client.local.port))) continue
    const server = index.get(`${String(client.remote.port)}|${String(client.local.port)}`)
    seen.add(client.key)
    if (server === undefined) {
      bySocket.set(client.key, { role: 'client', family: 'lan', reason: 'loopback-unresolved', peer: undefined })
      continue
    }
    seen.add(server.key)
    const clientOwned = client.owners.some(pid => treePids.has(pid))
    const serverOwned = server.owners.some(pid => treePids.has(pid))
    let family = 'lan'
    let reason = 'loopback-unresolved'
    if (clientOwned && serverOwned) {
      const sameProcess = client.owners.some(pid => server.owners.includes(pid))
      reason = sameProcess ? 'loopback-internal' : 'tree-loopback'
    } else if (clientOwned) {
      family = 'net-tcp'
      reason = 'tree-local-hop'
    } else if (serverOwned) {
      family = 'forwarded'
      reason = 'local-access'
    }
    bySocket.set(client.key, { role: 'client', family, reason, peer: server.key })
    bySocket.set(server.key, { role: 'server', family, reason, peer: client.key })
    pairs.push({
      client: client.key,
      server: server.key,
      clientPids: client.owners,
      serverPids: server.owners,
      localPort: server.local.port,
      family,
      reason,
    })
  }


  for (const [key, resolution] of bySocket) {
    if (resolution.role === 'server' && resolution.family === 'net-tcp') {
      bySocket.set(key, { ...resolution, family: 'lan', reason: `${resolution.reason}-server-end` })
    }
  }
  return { pairs, bySocket }
}

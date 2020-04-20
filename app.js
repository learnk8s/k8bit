const app = App()
let lastResourceVersion

fetch('/api/v1/pods')
  .then((response) => response.json())
  .then((response) => {
    const pods = response.items
    lastResourceVersion = response.metadata.resourceVersion
    pods.forEach((pod) => {
      const podId = `${pod.metadata.namespace}-${pod.metadata.name}`
      app.upsert(podId, pod)
    })
  })
  .then(() => streamUpdates())

function streamUpdates() {
  fetch(`/api/v1/pods?watch=1&resourceVersion=${lastResourceVersion}`)
    .then((response) => {
      const stream = response.body.getReader()
      const utf8Decoder = new TextDecoder('utf-8')
      let buffer = ''

      return stream.read().then(function processText({ done, value }) {
        if (done) {
          console.log('Request terminated')
          return
        }
        buffer += utf8Decoder.decode(value)
        buffer = onNewLine(buffer, (chunk) => {
          if (chunk.trim().length === 0) {
            return
          }
          try {
            const event = JSON.parse(chunk)
            console.log('PROCESSING EVENT: ', event)
            const pod = event.object
            const podId = `${pod.metadata.namespace}-${pod.metadata.name}`
            switch (event.type) {
              case 'ADDED': {
                app.upsert(podId, pod)
                break
              }
              case 'DELETED': {
                app.remove(podId)
                break
              }
              case 'MODIFIED': {
                app.upsert(podId, pod)
                break
              }
              default:
                break
            }
            lastResourceVersion = event.object.metadata.resourceVersion
          } catch (error) {
            console.log('Error while parsing', chunk, '\n', error)
          }
        })
        return stream.read().then(processText)
      })
    })
    .catch(() => {
      console.log('Error! Retrying in 5 seconds...')
      setTimeout(() => streamUpdates(), 5000)
    })

  function onNewLine(buffer, fn) {
    const newLineIndex = buffer.indexOf('\n')
    if (newLineIndex === -1) {
      return buffer
    }
    const chunk = buffer.slice(0, buffer.indexOf('\n'))
    const newBuffer = buffer.slice(buffer.indexOf('\n') + 1)
    fn(chunk)
    return onNewLine(newBuffer, fn)
  }
}

function App() {
  const allPods = new Map()
  const content = document.querySelector('#content')

  function render() {
    const pods = Array.from(allPods.values())
    if (pods.length === 0) {
      return
    }
    const podsByNode = groupBy(pods, (it) => it.nodeName)
    const nodeTemplates = Object.keys(podsByNode).map((nodeName) => {
      const pods = podsByNode[nodeName]
      return [
        '<li class="w5 mv4">',
        '<div>',
        `<p class="white ttu tc b f5 lh-copy">${nodeName}</p>`,
        `<div class="bg-dark-pink ba bw2 b--pink w4 h4 center">${renderNode(pods)}</div>`,
        '</div>',
        '</li>',
      ].join('')
    })

    content.innerHTML = `<ul class="list pl0 flex flex-wrap center">${nodeTemplates.join('')}</ul>`

    function renderNode(pods) {
      return [
        '<ul class="list pl0 flex flex-wrap">',
        pods
          .map((pod) =>
            [
              '<li class="relative">',
              `<div class="ma1 w1 h1 bg-green" data-tooltip="${pod.name}"></div>`,
              '</li>',
            ].join(''),
          )
          .join(''),
        '</ul>',
      ].join('')
    }
  }

  return {
    upsert(podId, pod) {
      if (!pod.spec.nodeName) {
        return
      }
      allPods.set(podId, {
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        nodeName: pod.spec.nodeName,
      })
      render()
    },
    remove(podId) {
      allPods.delete(podId)
      render()
    },
  }
}

function groupBy(arr, groupByKeyFn) {
  return arr.reduce((acc, c) => {
    const key = groupByKeyFn(c)
    if (!(key in acc)) {
      acc[key] = []
    }
    acc[key].push(c)
    return acc
  }, {})
}

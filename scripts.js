"use strict";

class App {
  constructor () {
    this.btnRecord = document.getElementById('btn-record');
    this.btnStop = document.getElementById('btn-stop');

    this.debugTxt = document.getElementById('debug-txt')

    this.recordingsCont = document.getElementById('recordings-cont')

    this.isRecording = false
    this.saveNextRecording = false

    this.debugTxt.innerHTML = "stopped"
  }

  init () {
    this._initEventListeners()
  }

  _initEventListeners () {

    this.btnRecord.addEventListener('click', evt => {
      this._stopAllRecording()
      this.saveNextRecording = true
      this._startRecording()

      this.btnRecord.disabled = true
      this.btnStop.disabled = false
      this.debugTxt.innerHTML = "recording"
    })

    this.btnStop.addEventListener('click', evt => {
      this._stopAllRecording();

      this.btnRecord.disabled = false
      this.btnStop.disabled = true
      this.debugTxt.innerHTML = "stopped"
    })
  }

  _startRecording () {
    if (!this.recorderSrvc) {
      this.recorderSrvc = new RecorderService()
      this.recorderSrvc.em.addEventListener('recording', (evt) => this._onNewRecording(evt))
    }

    if (!this.webAudioPeakMeter) {
      this.webAudioPeakMeter = new WebAudioPeakMeter()
      this.meterEl = document.getElementById('recording-meter')
    }

    this.recorderSrvc.onGraphSetupWithInputStream = (inputStreamNode) => {
      this.meterNodeRaw = this.webAudioPeakMeter.createMeterNode(inputStreamNode, this.recorderSrvc.audioCtx)
      this.webAudioPeakMeter.createMeter(this.meterEl, this.meterNodeRaw, {})
    }

    this.recorderSrvc.startRecording()
    this.isRecording = true
    this.debugTxt.innerHTML = "recording..."
  }

  _stopAllRecording () {
    if (this.recorderSrvc && this.isRecording) {

      this.recorderSrvc.stopRecording()
      this.isRecording = false

      if (this.meterNodeRaw) {
        this.meterNodeRaw.disconnect()
        this.meterNodeRaw = null
        this.meterEl.innerHTML = ''
      }
    }
  }

  _onNewRecording (evt) {
    if (!this.saveNextRecording) {
      return
    }
    const newIdx = this.recordingsCont.childNodes.length + 1

    const newEl = document.createElement('div')
    newEl.innerHTML = '<audio id="audio-recording-' + newIdx + '" controls></audio>'
    this.recordingsCont.appendChild(newEl)

    const recordingEl = document.getElementById("audio-recording-" + newIdx);
    recordingEl.src = evt.detail.recording.blobUrl
    recordingEl.type = evt.detail.recording.mimeType
  }
}

;// Parts copied from https://github.com/chris-rudmin/Recorderjs
let BYTES_PER_SAMPLE = 2
let recorded = []

function encode (buffer) {
  let length = buffer.length
  let data = new Uint8Array(length * BYTES_PER_SAMPLE)
  for (let i = 0; i < length; i++) {
    let index = i * BYTES_PER_SAMPLE
    let sample = buffer[i]
    if (sample > 1) {
      sample = 1
    }
    else if (sample < -1) {
      sample = -1
    }
    sample = sample * 32768
    data[index] = sample
    data[index + 1] = sample >> 8
  }
  recorded.push(data)
}

function dump (sampleRate) {
  let bufferLength = recorded.length ? recorded[0].length : 0
  let length = recorded.length * bufferLength
  let wav = new Uint8Array(44 + length)

  let view = new DataView(wav.buffer)

  // RIFF identifier 'RIFF'
  view.setUint32(0, 1380533830, false)
  // file length minus RIFF identifier length and file description length
  view.setUint32(4, 36 + length, true)
  // RIFF type 'WAVE'
  view.setUint32(8, 1463899717, false)
  // format chunk identifier 'fmt '
  view.setUint32(12, 1718449184, false)
  // format chunk length
  view.setUint32(16, 16, true)
  // sample format (raw)
  view.setUint16(20, 1, true)
  // channel count
  view.setUint16(22, 1, true)
  // sample rate
  view.setUint32(24, sampleRate, true)
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true)
  // block align (channel count * bytes per sample)
  view.setUint16(32, BYTES_PER_SAMPLE, true)
  // bits per sample
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true)
  // data chunk identifier 'data'
  view.setUint32(36, 1684108385, false)
  // data chunk length
  view.setUint32(40, length, true)

  for (var i = 0; i < recorded.length; i++) {
    wav.set(recorded[i], i * bufferLength + 44)
  }

  recorded = []
  let msg = [wav.buffer]
  postMessage(msg, [msg[0]])
}

onmessage = function (e) {
  if (e.data[0] === 'encode') {
    encode(e.data[1])
  }
  else if (e.data[0] === 'dump') {
    dump(e.data[1])
  }
  else if (e.data[0] === 'close') {
    self.close()
  }
}


;class RecorderService {
    constructor () {
      window.AudioContext = window.AudioContext || window.webkitAudioContext
  
      this.em = document.createDocumentFragment()
  
      this.state = 'inactive'
  
      this.chunks = []
      this.chunkType = ''
  
      this.encoderMimeType = 'audio/wav'
  
      this.config = {
        manualEncoderId: 'wav',
        micGain: 1.0,
        processorBufferSize: 2048,
        stopTracksAndCloseCtxWhenFinished: true,
        usingMediaRecorder: typeof window.MediaRecorder !== 'undefined',
        //userMediaConstraints: { audio: true }
        userMediaConstraints: { audio: { echoCancellation: false } }
      }
    }
  
    /* Returns promise */
    startRecording () {
      if (this.state !== 'inactive') {
        return
      }
  
      // This is the case on ios/chrome, when clicking links from within ios/slack (sometimes), etc.
      if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Missing support for navigator.mediaDevices.getUserMedia') // temp: helps when testing for strange issues on ios/safari
        return
      }
  
      this.audioCtx = new AudioContext()
      this.micGainNode = this.audioCtx.createGain()
      this.outputGainNode = this.audioCtx.createGain()
  
      // If not using MediaRecorder(i.e. safari and edge), then a script processor is required. It's optional
      // on browsers using MediaRecorder and is only useful if wanting to do custom analysis or manipulation of
      // recorded audio data.
      if (!this.config.usingMediaRecorder) {
        this.processorNode = this.audioCtx.createScriptProcessor(this.config.processorBufferSize, 1, 1) // TODO: Get the number of channels from mic
      }
  
      // Create stream destination on chrome/firefox because, AFAICT, we have no other way of feeding audio graph output
      // in to MediaRecorder. Safari/Edge don't have this method as of 2018-04.
      if (this.audioCtx.createMediaStreamDestination) {
        this.destinationNode = this.audioCtx.createMediaStreamDestination()
      }
      else {
        this.destinationNode = this.audioCtx.destination
      }
  
      // Create web worker for doing the encoding
      if (!this.config.usingMediaRecorder) {
        this.encoderWorker = new Worker('js/encoder-wav-worker.js')
        this.encoderMimeType = 'audio/wav'
  
        this.encoderWorker.addEventListener('message', (e) => {
          let event = new Event('dataavailable')
          event.data = new Blob(e.data, { type: this.encoderMimeType })
          this._onDataAvailable(event)
        })
      }
  
      // This will prompt user for permission if needed
      return navigator.mediaDevices.getUserMedia(this.config.userMediaConstraints)
        .then((stream) => {
          this._startRecordingWithStream(stream)
        })
        .catch((error) => {
          alert('Error with getUserMedia: ' + error.message) // temp: helps when testing for strange issues on ios/safari
          console.log(error)
        })
    }
  
    _startRecordingWithStream (stream) {
      this.micAudioStream = stream
  
      this.inputStreamNode = this.audioCtx.createMediaStreamSource(this.micAudioStream)
      this.audioCtx = this.inputStreamNode.context
  
      // Allow optionally hooking in to audioGraph inputStreamNode, useful for meters
      if (this.onGraphSetupWithInputStream) {
        this.onGraphSetupWithInputStream(this.inputStreamNode)
      }
  
      this.inputStreamNode.connect(this.micGainNode)
      this.micGainNode.gain.setValueAtTime(this.config.micGain, this.audioCtx.currentTime)
  
      let nextNode = this.micGainNode
  
      this.state = 'recording'
  
      if (this.processorNode) {
        nextNode.connect(this.processorNode)
        this.processorNode.connect(this.outputGainNode)
        this.processorNode.onaudioprocess = (e) => this._onAudioProcess(e)
      }
      else {
        nextNode.connect(this.outputGainNode)
      }
  
      this.outputGainNode.connect(this.destinationNode)
  
      if (this.config.usingMediaRecorder) {
        this.mediaRecorder = new MediaRecorder(this.destinationNode.stream)
        this.mediaRecorder.addEventListener('dataavailable', (evt) => this._onDataAvailable(evt))
        this.mediaRecorder.addEventListener('error', (evt) => this._onError(evt))
  
        this.mediaRecorder.start()
      }
      else {
        // Output gain to zero to prevent feedback. Seems to matter only on Edge, though seems like should matter
        // on iOS too.  Matters on chrome when connecting graph to directly to audioCtx.destination, but we are
        // not able to do that when using MediaRecorder.
        this.outputGainNode.gain.setValueAtTime(0, this.audioCtx.currentTime)
      }
    }
  
    _onAudioProcess (e) {
      if (this.config.broadcastAudioProcessEvents) {
        this.em.dispatchEvent(new CustomEvent('onaudioprocess', {
          detail: {
            inputBuffer: e.inputBuffer,
            outputBuffer: e.outputBuffer
          }
        }))
      }
  
      // Safari and Edge require manual encoding via web worker. Single channel only for now.
      // Example stereo encoderWav: https://github.com/MicrosoftEdge/Demos/blob/master/microphone/scripts/recorderworker.js
      if (!this.config.usingMediaRecorder) {
        if (this.state === 'recording') {
          if (this.config.broadcastAudioProcessEvents) {
            this.encoderWorker.postMessage(['encode', e.outputBuffer.getChannelData(0)])
          }
          else {
            this.encoderWorker.postMessage(['encode', e.inputBuffer.getChannelData(0)])
          }
        }
      }
    }
  
    stopRecording () {
      if (this.state === 'inactive') {
        return
      }
  
      if (this.config.usingMediaRecorder) {
        this.state = 'inactive'
        this.mediaRecorder.stop()
      }
      else {
        this.state = 'inactive'
        this.encoderWorker.postMessage(['dump', this.audioCtx.sampleRate])
      }
    }
  
    _onDataAvailable (evt) {
      this.chunks.push(evt.data)
      this.chunkType = evt.data.type
  
      if (this.state !== 'inactive') {
        return
      }
  
      let blob = new Blob(this.chunks, { 'type': this.chunkType })
      let blobUrl = URL.createObjectURL(blob)
      const recording = {
        ts: new Date().getTime(),
        blobUrl: blobUrl,
        mimeType: blob.type,
        size: blob.size
      }
  
      this.chunks = []
      this.chunkType = null
  
      if (this.destinationNode) {
        this.destinationNode.disconnect()
        this.destinationNode = null
      }
      if (this.outputGainNode) {
        this.outputGainNode.disconnect()
        this.outputGainNode = null
      }
  
      if (this.processorNode) {
        this.processorNode.disconnect()
        this.processorNode = null
      }
  
      if (this.encoderWorker) {
        this.encoderWorker.postMessage(['close'])
        this.encoderWorker = null
      }
  
      if (this.micGainNode) {
        this.micGainNode.disconnect()
        this.micGainNode = null
      }
      if (this.inputStreamNode) {
        this.inputStreamNode.disconnect()
        this.inputStreamNode = null
      }
  
      if (this.config.stopTracksAndCloseCtxWhenFinished) {
        // This removes the red bar in iOS/Safari
        this.micAudioStream.getTracks().forEach((track) => track.stop())
        this.micAudioStream = null
  
        this.audioCtx.close()
        this.audioCtx = null
      }
  
      this.em.dispatchEvent(new CustomEvent('recording', { detail: { recording: recording } }))
    }
  
    _onError (evt) {
      console.log('error', evt)
      this.em.dispatchEvent(new Event('error'))
      alert('error:' + evt) // for debugging purposes
    }
  }
  
;/**
 * Copied from https://github.com/esonderegger/web-audio-peak-meter
 * Modified to class form to allow multiple instances on a page.
 */
 class WebAudioPeakMeter {
    constructor () {
      this.options = {
        borderSize: 2,
        fontSize: 9,
        backgroundColor: 'black',
        tickColor: '#ddd',
        gradient: ['red 1%', '#ff0 16%', 'lime 45%', '#080 100%'],
        dbRange: 48,
        dbTickSize: 6,
        maskTransition: 'height 0.1s'
      }
  
      // this.tickWidth
      // this.elementWidth
      // this.elementHeight
      // this.meterHeight
      // this.meterWidth
      // this.meterTop
      this.vertical = true
      this.channelCount = 1
      this.channelMasks = []
      this.channelPeaks = []
      this.channelPeakLabels = []
    }
  
    getBaseLog (x, y) {
      return Math.log(y) / Math.log(x)
    }
  
    dbFromFloat (floatVal) {
      return this.getBaseLog(10, floatVal) * 20
    }
  
    setOptions (userOptions) {
      for (var k in userOptions) {
        this.options[k] = userOptions[k]
      }
      this.tickWidth = this.options.fontSize * 2.0
      this.meterTop = this.options.fontSize * 1.5 + this.options.borderSize
    }
  
    createMeterNode (sourceNode, audioCtx) {
      var c = sourceNode.channelCount
      var meterNode = audioCtx.createScriptProcessor(2048, c, c)
      sourceNode.connect(meterNode)
      meterNode.connect(audioCtx.destination)
      return meterNode
    }
  
    createContainerDiv (parent) {
      var meterElement = document.createElement('div')
      meterElement.style.position = 'relative'
      meterElement.style.width = this.elementWidth + 'px'
      meterElement.style.height = this.elementHeight + 'px'
      meterElement.style.backgroundColor = this.options.backgroundColor
      parent.appendChild(meterElement)
      return meterElement
    }
  
    createMeter (domElement, meterNode, optionsOverrides) {
      this.setOptions(optionsOverrides)
      this.elementWidth = domElement.clientWidth
      this.elementHeight = domElement.clientHeight
      var meterElement = this.createContainerDiv(domElement)
      if (this.elementWidth > this.elementHeight) {
        this.vertical = false
      }
      this.meterHeight = this.elementHeight - this.meterTop - this.options.borderSize
      this.meterWidth = this.elementWidth - this.tickWidth - this.options.borderSize
      this.createTicks(meterElement)
      this.createRainbow(meterElement, this.meterWidth, this.meterHeight,
        this.meterTop, this.tickWidth)
      this.channelCount = meterNode.channelCount
      var channelWidth = this.meterWidth / this.channelCount
      var channelLeft = this.tickWidth
      for (var i = 0; i < this.channelCount; i++) {
        this.createChannelMask(meterElement, this.options.borderSize,
          this.meterTop, channelLeft, false)
        this.channelMasks[i] = this.createChannelMask(meterElement, channelWidth,
          this.meterTop, channelLeft,
          this.options.maskTransition)
        this.channelPeaks[i] = 0.0
        this.channelPeakLabels[i] = this.createPeakLabel(meterElement, channelWidth,
          channelLeft)
        channelLeft += channelWidth
      }
      meterNode.onaudioprocess = (e) => this.updateMeter(e)
      meterElement.addEventListener('click', function () {
        for (var i = 0; i < this.channelCount; i++) {
          this.channelPeaks[i] = 0.0
          this.channelPeakLabels[i].textContent = '-∞'
        }
      }, false)
    }
  
    createTicks (parent) {
      var numTicks = Math.floor(this.options.dbRange / this.options.dbTickSize)
      var dbTickLabel = 0
      var dbTickTop = this.options.fontSize + this.options.borderSize
      for (var i = 0; i < numTicks; i++) {
        var dbTick = document.createElement('div')
        parent.appendChild(dbTick)
        dbTick.style.width = this.tickWidth + 'px'
        dbTick.style.textAlign = 'right'
        dbTick.style.color = this.options.tickColor
        dbTick.style.fontSize = this.options.fontSize + 'px'
        dbTick.style.position = 'absolute'
        dbTick.style.top = dbTickTop + 'px'
        dbTick.textContent = dbTickLabel + ''
        dbTickLabel -= this.options.dbTickSize
        dbTickTop += this.meterHeight / numTicks
      }
    }
  
    createRainbow (parent, width, height, top, left) {
      var rainbow = document.createElement('div')
      parent.appendChild(rainbow)
      rainbow.style.width = width + 'px'
      rainbow.style.height = height + 'px'
      rainbow.style.position = 'absolute'
      rainbow.style.top = top + 'px'
      rainbow.style.left = left + 'px'
      var gradientStyle = 'linear-gradient(' + this.options.gradient.join(', ') + ')'
      rainbow.style.backgroundImage = gradientStyle
      return rainbow
    }
  
    createPeakLabel (parent, width, left) {
      var label = document.createElement('div')
      parent.appendChild(label)
      label.style.width = width + 'px'
      label.style.textAlign = 'center'
      label.style.color = this.options.tickColor
      label.style.fontSize = this.options.fontSize + 'px'
      label.style.position = 'absolute'
      label.style.top = this.options.borderSize + 'px'
      label.style.left = left + 'px'
      label.textContent = '-∞'
      return label
    }
  
    createChannelMask (parent, width, top, left, transition) {
      var channelMask = document.createElement('div')
      parent.appendChild(channelMask)
      channelMask.style.width = width + 'px'
      channelMask.style.height = this.meterHeight + 'px'
      channelMask.style.position = 'absolute'
      channelMask.style.top = top + 'px'
      channelMask.style.left = left + 'px'
      channelMask.style.backgroundColor = this.options.backgroundColor
      if (transition) {
        channelMask.style.transition = this.options.maskTransition
      }
      return channelMask
    }
  
    maskSize (floatVal) {
      if (floatVal === 0.0) {
        return this.meterHeight
      }
      else {
        var d = this.options.dbRange * -1
        var returnVal = Math.floor(this.dbFromFloat(floatVal) * this.meterHeight / d)
        if (returnVal > this.meterHeight) {
          return this.meterHeight
        }
        else {
          return returnVal
        }
      }
    }
  
    updateMeter (audioProcessingEvent) {
      var inputBuffer = audioProcessingEvent.inputBuffer
      var i
      var channelData = []
      var channelMaxes = []
      for (i = 0; i < this.channelCount; i++) {
        channelData[i] = inputBuffer.getChannelData(i)
        channelMaxes[i] = 0.0
      }
      for (var sample = 0; sample < inputBuffer.length; sample++) {
        for (i = 0; i < this.channelCount; i++) {
          if (Math.abs(channelData[i][sample]) > channelMaxes[i]) {
            channelMaxes[i] = Math.abs(channelData[i][sample])
          }
        }
      }
      for (i = 0; i < this.channelCount; i++) {
        var thisMaskSize = this.maskSize(channelMaxes[i], this.meterHeight)
        this.channelMasks[i].style.height = thisMaskSize + 'px'
        if (channelMaxes[i] > this.channelPeaks[i]) {
          this.channelPeaks[i] = channelMaxes[i]
          var labelText = this.dbFromFloat(this.channelPeaks[i]).toFixed(1)
          this.channelPeakLabels[i].textContent = labelText
        }
      }
    }
  }
  
;
//# sourceMappingURL=scripts.js.map
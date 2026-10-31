const state = {
context: null,
master: null,
compressor: null,
impulse: null,
voices: [
{ wave: 'triangle', volume: .48, detune: 0, attack: .18, release: 1.7, sustain: .56, pan: -.52, channel: null },
{ wave: 'sine', volume: .42, detune: 4, attack: .24, release: 2.1, sustain: .48, pan: .52, channel: null }
],
effects: { delay: false, reverb: false, chorus: false },
effectValues: { delay: .32, reverb: .38, chorus: .1 },
activeNotes: new Set(),
drumLoops: { kick: null, snare: null, hat: null, clap: null },
sequenceTimer: null,
step: 0,
outputMode: 'stereo'
}

const NOTES = { A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392 }

const PATTERN = [
['A2', 'E4'], [null, 'C4'], ['C3', null], [null, 'G3'],
['E3', null], [null, 'A3'], ['C3', null], [null, 'G3'],
['G3', 'D4'], [null, 'C4'], ['E3', null], [null, 'A3'],
['D3', null], [null, 'G3'], ['C3', null], [null, 'E4']
]

function holdParam(param, now) {
if (typeof param.cancelAndHoldAtTime === 'function') {
param.cancelAndHoldAtTime(now)
return
}
const value = param.value
param.cancelScheduledValues(now)
param.setValueAtTime(value, now)
}

function smoothParam(param, value, duration = .1) {
if (!state.context) return
const now = state.context.currentTime
holdParam(param, now)
param.linearRampToValueAtTime(value, now + duration)
}

function createImpulse(ctx, duration = 3.1, decay = 4) {
const length = Math.floor(ctx.sampleRate * duration)
const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
for (let channel = 0; channel < 2; channel += 1) {
const data = impulse.getChannelData(channel)
let smoothed = 0
for (let i = 0; i < length; i += 1) {
smoothed = smoothed * .68 + (Math.random() * 2 - 1) * .32
data[i] = smoothed * Math.pow(1 - i / length, decay)
}
}
return impulse
}

function ensureAudio() {
if (state.context) {
if (state.context.state === 'suspended') state.context.resume()
return
}
const AudioCtx = window.AudioContext || window.webkitAudioContext
const ctx = new AudioCtx({ latencyHint: 'interactive' })
state.context = ctx
state.master = ctx.createGain()
state.compressor = ctx.createDynamicsCompressor()
state.compressor.threshold.value = -15
state.compressor.knee.value = 26
state.compressor.ratio.value = 2
state.compressor.attack.value = .025
state.compressor.release.value = .5
state.master.gain.value = Number(document.querySelector('#masterVolume').value) * .68
state.master.connect(state.compressor).connect(ctx.destination)
state.impulse = createImpulse(ctx)
state.voices.forEach((voice, index) => { voice.channel = createChannel(index) })
ctx.resume()
}

function cutoffForWave(wave, index) {
const cutoff = { sine: 4300, triangle: 2100, square: 760, sawtooth: 980 }[wave] || 1800
return index === 0 ? cutoff : cutoff * 1.15
}

function delayTime(value) {
return .24 + value * .46
}

function createChannel(index) {
const ctx = state.context
const voice = state.voices[index]
const input = ctx.createGain()
const voiceLevel = ctx.createGain()
const delayOutput = ctx.createGain()
const delay = ctx.createDelay(1.3)
const delaySecond = ctx.createDelay(1.3)
const delayWet = ctx.createGain()
const delaySecondWet = ctx.createGain()
const reverbOutput = ctx.createGain()
const convolver = ctx.createConvolver()
const reverbFilter = ctx.createBiquadFilter()
const reverbWet = ctx.createGain()
const chorusOutput = ctx.createGain()
const chorusDelay = ctx.createDelay(.05)
const chorusWet = ctx.createGain()
const chorusLfo = ctx.createOscillator()
const chorusDepth = ctx.createGain()
const panner = ctx.createStereoPanner()

voiceLevel.gain.value = voice.volume * .5
delay.delayTime.value = delayTime(state.effectValues.delay)
delaySecond.delayTime.value = Math.min(1.2, delayTime(state.effectValues.delay) * 1.65)
delayWet.gain.value = state.effects.delay ? .12 + state.effectValues.delay * .35 : 0
delaySecondWet.gain.value = state.effects.delay ? .06 + state.effectValues.delay * .18 : 0
convolver.buffer = state.impulse
reverbFilter.type = 'lowpass'
reverbFilter.frequency.value = 3400
reverbWet.gain.value = state.effects.reverb ? .08 + state.effectValues.reverb * .65 : 0
chorusDelay.delayTime.value = .019
chorusWet.gain.value = state.effects.chorus ? .08 + state.effectValues.chorus * .42 : 0
chorusLfo.frequency.value = .22
chorusDepth.gain.value = .001 + state.effectValues.chorus * .008
panner.pan.value = state.outputMode === 'mono' ? 0 : voice.pan

input.connect(voiceLevel)
voiceLevel.connect(delayOutput)
voiceLevel.connect(delay).connect(delayWet).connect(delayOutput)
voiceLevel.connect(delaySecond).connect(delaySecondWet).connect(delayOutput)
delayOutput.connect(reverbOutput)
delayOutput.connect(convolver).connect(reverbFilter).connect(reverbWet).connect(reverbOutput)
reverbOutput.connect(chorusOutput)
reverbOutput.connect(chorusDelay).connect(chorusWet).connect(chorusOutput)
chorusLfo.connect(chorusDepth).connect(chorusDelay.delayTime)
chorusOutput.connect(panner).connect(state.master)
chorusLfo.start()

return { input, voiceLevel, delay, delaySecond, delayWet, delaySecondWet, reverbWet, chorusWet, chorusDepth, panner }
}

function restoreMaster() {
if (!state.master || !state.context || state.master.gain.value > .001) return
state.master.gain.setValueAtTime(Number(document.querySelector('#masterVolume').value) * .68, state.context.currentTime)
}

function playVoice(index, frequency) {
ensureAudio()
restoreMaster()
const ctx = state.context
const voice = state.voices[index]
const now = ctx.currentTime
const oscillator = ctx.createOscillator()
const softLayer = ctx.createOscillator()
const softGain = ctx.createGain()
const filter = ctx.createBiquadFilter()
const envelope = ctx.createGain()
const note = { oscillator, softLayer, envelope, stopped: false }

oscillator.type = voice.wave
oscillator.frequency.setValueAtTime(frequency, now)
oscillator.detune.setValueAtTime(voice.detune, now)
softLayer.type = 'sine'
softLayer.frequency.setValueAtTime(frequency, now)
softLayer.detune.setValueAtTime(index === 0 ? -5 : 5, now)
softGain.gain.value = index === 0 ? .12 : .16
filter.type = 'lowpass'
filter.frequency.value = cutoffForWave(voice.wave, index)
filter.Q.value = .35
envelope.gain.setValueAtTime(.0001, now)
envelope.gain.exponentialRampToValueAtTime(.82, now + Math.max(.04, voice.attack))
envelope.gain.setTargetAtTime(voice.sustain, now + Math.max(.04, voice.attack), .2)
const holdTime = stepDuration() / 1000 * 1.15
envelope.gain.setTargetAtTime(.0001, now + holdTime, Math.max(.18, voice.release / 3.2))

oscillator.connect(filter)
softLayer.connect(softGain).connect(filter)
filter.connect(envelope).connect(voice.channel.input)
oscillator.start(now)
softLayer.start(now)
const stopAt = now + holdTime + voice.release + .3
oscillator.stop(stopAt)
softLayer.stop(stopAt)
state.activeNotes.add(note)
oscillator.addEventListener('ended', () => state.activeNotes.delete(note), { once: true })
}

function stopAllNotes() {
if (!state.context) return
const now = state.context.currentTime
state.activeNotes.forEach(note => {
if (note.stopped) return
note.stopped = true
holdParam(note.envelope.gain, now)
note.envelope.gain.exponentialRampToValueAtTime(.0001, now + .12)
try { note.oscillator.stop(now + .16) } catch {}
try { note.softLayer.stop(now + .16) } catch {}
})
}

function stopEverything() {
Object.keys(state.drumLoops).forEach(type => {
if (state.drumLoops[type]) window.clearInterval(state.drumLoops[type])
state.drumLoops[type] = null
const button = document.querySelector(`[data-drum="${type}"]`)
button.classList.remove('is-looping', 'is-hit')
button.setAttribute('aria-pressed', 'false')
})
stopAllNotes()
if (state.master && state.context) smoothParam(state.master.gain, .0001, .16)
}

function softNoiseBuffer(seconds = .25) {
const ctx = state.context
const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
const data = buffer.getChannelData(0)
let previous = 0
for (let i = 0; i < data.length; i += 1) {
previous = previous * .86 + (Math.random() * 2 - 1) * .14
data[i] = previous
}
return buffer
}

function hitDrum(type) {
ensureAudio()
restoreMaster()
const ctx = state.context
const now = ctx.currentTime
const pan = ctx.createStereoPanner()
pan.pan.value = state.outputMode === 'mono' ? 0 : ({ kick: 0, snare: -.16, hat: .26, clap: -.26 }[type])
pan.connect(state.master)
if (type === 'kick') {
const oscillator = ctx.createOscillator()
const gain = ctx.createGain()
oscillator.type = 'sine'
oscillator.frequency.setValueAtTime(68, now)
oscillator.frequency.exponentialRampToValueAtTime(45, now + .24)
gain.gain.setValueAtTime(.2, now)
gain.gain.exponentialRampToValueAtTime(.0001, now + .38)
oscillator.connect(gain).connect(pan)
oscillator.start(now)
oscillator.stop(now + .4)
} else {
const source = ctx.createBufferSource()
const filter = ctx.createBiquadFilter()
const gain = ctx.createGain()
source.buffer = softNoiseBuffer(type === 'clap' ? .4 : .23)
filter.type = type === 'hat' ? 'highpass' : 'bandpass'
filter.frequency.value = type === 'hat' ? 3800 : type === 'clap' ? 980 : 760
filter.Q.value = .45
gain.gain.setValueAtTime({ snare: .065, hat: .03, clap: .055 }[type], now)
if (type === 'clap') {
gain.gain.exponentialRampToValueAtTime(.004, now + .07)
gain.gain.setValueAtTime(.037, now + .11)
}
gain.gain.exponentialRampToValueAtTime(.0001, now + (type === 'clap' ? .38 : .21))
source.connect(filter).connect(gain).connect(pan)
source.start(now)
}
const button = document.querySelector(`[data-drum="${type}"]`)
button.classList.add('is-hit')
window.setTimeout(() => button.classList.remove('is-hit'), 140)
}

function toggleDrum(type) {
const button = document.querySelector(`[data-drum="${type}"]`)
if (state.drumLoops[type]) {
window.clearInterval(state.drumLoops[type])
state.drumLoops[type] = null
button.classList.remove('is-looping')
button.setAttribute('aria-pressed', 'false')
return
}
ensureAudio()
hitDrum(type)
const intervals = { kick: stepDuration() * 4, snare: stepDuration() * 4, hat: stepDuration() * 2, clap: stepDuration() * 4 }
state.drumLoops[type] = window.setInterval(() => hitDrum(type), intervals[type])
button.classList.add('is-looping')
button.setAttribute('aria-pressed', 'true')
}

function applyEffectValue(name, value, duration = .15) {
state.effectValues[name] = value
if (!state.context) return
const now = state.context.currentTime
state.voices.forEach(voice => {
const channel = voice.channel
if (!channel) return
if (name === 'delay') {
channel.delay.delayTime.setTargetAtTime(delayTime(value), now, duration)
channel.delaySecond.delayTime.setTargetAtTime(Math.min(1.2, delayTime(value) * 1.65), now, duration)
if (state.effects.delay) {
channel.delayWet.gain.setTargetAtTime(.12 + value * .35, now, duration)
channel.delaySecondWet.gain.setTargetAtTime(.06 + value * .18, now, duration)
}
}
if (name === 'reverb' && state.effects.reverb) channel.reverbWet.gain.setTargetAtTime(.08 + value * .65, now, duration)
if (name === 'chorus') {
channel.chorusDepth.gain.setTargetAtTime(.001 + value * .008, now, duration)
if (state.effects.chorus) channel.chorusWet.gain.setTargetAtTime(.08 + value * .42, now, duration)
}
})
}

function setEffectEnabled(name, enabled) {
state.effects[name] = enabled
const button = document.querySelector(`[data-effect="${name}"] button`)
button.classList.toggle('is-active', enabled)
button.setAttribute('aria-pressed', String(enabled))
if (!state.context) return
const now = state.context.currentTime
state.voices.forEach(voice => {
const channel = voice.channel
if (!channel) return
if (name === 'delay') {
channel.delayWet.gain.setTargetAtTime(enabled ? .12 + state.effectValues.delay * .35 : 0, now, .18)
channel.delaySecondWet.gain.setTargetAtTime(enabled ? .06 + state.effectValues.delay * .18 : 0, now, .18)
}
if (name === 'reverb') channel.reverbWet.gain.setTargetAtTime(enabled ? .08 + state.effectValues.reverb * .65 : 0, now, .2)
if (name === 'chorus') channel.chorusWet.gain.setTargetAtTime(enabled ? .08 + state.effectValues.chorus * .42 : 0, now, .2)
})
}

function sequenceStep() {
const position = state.step % 32
const pair = PATTERN[state.step % PATTERN.length]
pair.forEach((note, index) => { if (note) playVoice(index, NOTES[note]) })
if ([8, 24].includes(position)) hitDrum('kick')
if (position === 28) hitDrum('snare')
if ([6, 14, 22, 30].includes(position)) hitDrum('hat')
if (position === 20) hitDrum('clap')
state.step += 1
}

function stepDuration() {
return 60000 / 82 / 2
}

function toggleSequence() {
ensureAudio()
const button = document.querySelector('#playButton')
if (state.sequenceTimer) {
window.clearInterval(state.sequenceTimer)
state.sequenceTimer = null
button.classList.remove('is-playing')
button.setAttribute('aria-pressed', 'false')
button.textContent = 'START'
stopEverything()
return
}
smoothParam(state.master.gain, Number(document.querySelector('#masterVolume').value) * .68, .14)
state.step = 0
sequenceStep()
state.sequenceTimer = window.setInterval(sequenceStep, stepDuration())
button.classList.add('is-playing')
button.setAttribute('aria-pressed', 'true')
button.textContent = 'STOP'
}

document.querySelectorAll('.voice').forEach((panel, index) => {
panel.querySelectorAll('[data-param]').forEach(input => {
input.addEventListener('input', () => {
const param = input.dataset.param
const value = Number(input.value)
const voice = state.voices[index]
voice[param] = value
if (param === 'volume' && voice.channel) smoothParam(voice.channel.voiceLevel.gain, value * .5, .14)
})
})
panel.querySelectorAll('[data-wave]').forEach(button => {
button.addEventListener('click', () => {
panel.querySelectorAll('[data-wave]').forEach(item => item.classList.remove('is-active'))
button.classList.add('is-active')
state.voices[index].wave = button.dataset.wave
})
})
})

document.querySelectorAll('[data-drum]').forEach(button => {
button.setAttribute('aria-pressed', 'false')
button.addEventListener('click', () => toggleDrum(button.dataset.drum))
})

document.querySelector('#playButton').addEventListener('click', toggleSequence)
document.querySelector('#masterVolume').addEventListener('input', event => {
if (state.master) smoothParam(state.master.gain, Number(event.target.value) * .68, .12)
})

document.querySelectorAll('.effect').forEach(effect => {
const name = effect.dataset.effect
const button = effect.querySelector('button')
const range = effect.querySelector('input')
button.addEventListener('click', () => {
setEffectEnabled(name, !state.effects[name])
})
range.addEventListener('input', () => applyEffectValue(name, Number(range.value)))
})

document.querySelectorAll('[data-mode]').forEach(button => {
button.addEventListener('click', () => {
state.outputMode = button.dataset.mode
document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('is-active', item === button))
state.voices.forEach(voice => {
if (voice.channel) smoothParam(voice.channel.panner.pan, state.outputMode === 'mono' ? 0 : voice.pan, .14)
})
})
})

const keyMap = { q: 'kick', w: 'snare', e: 'hat', r: 'clap' }
document.addEventListener('keydown', event => {
if (event.repeat || event.target.matches('input')) return
const drum = keyMap[event.key.toLowerCase()]
if (drum) hitDrum(drum)
})

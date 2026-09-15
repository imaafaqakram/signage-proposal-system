<template>
  <div class="vec-backdrop no-print" @click.self="$emit('close')">
    <div class="vec-modal" @click.stop>
      <div class="vec-header">
        <div>
          <h3>Vector outline</h3>
          <p class="vec-sub">{{ label || 'Sign image' }} — {{ clientName || 'client' }}</p>
        </div>
        <button class="vec-close" @click="$emit('close')" title="Close"><i class="fas fa-times"></i></button>
      </div>

      <div class="vec-body">
        <div class="vec-panel">
          <span class="vec-panel-label">Original</span>
          <div class="vec-stage vec-stage-dark">
            <img :src="src" class="vec-preview-img" />
          </div>
        </div>
        <div class="vec-panel">
          <span class="vec-panel-label">Vector result</span>
          <div class="vec-stage vec-stage-light">
            <div v-if="tracing" class="vec-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>
            <div v-else class="vec-svg-holder" v-html="svg"></div>
          </div>
        </div>
      </div>

      <div class="vec-controls">
        <div class="vec-row">
          <label>Sensitivity</label>
          <input
            type="range"
            min="4"
            max="50"
            step="1"
            v-model.number="sensitivity"
            @change="retrace"
          />
          <span class="vec-val">{{ sensitivity }}</span>
        </div>
        <div class="vec-row vec-row-actions">
          <label class="vec-check">
            <input type="checkbox" v-model="invert" @change="retrace" />
            <span>Dark lettering</span>
          </label>
          <span class="vec-stat" v-if="!tracing && pathCount">{{ pathCount }} shapes</span>
          <button class="vec-btn-reset" @click="resetAuto">Auto</button>
          <button class="vec-btn-download" :disabled="tracing || !svg" @click="download">
            <i class="fas fa-download"></i> Download SVG
          </button>
        </div>
        <p class="vec-hint">
          Slide until only the sign lettering is solid and the wall behind it is gone. This is
          a starting outline — open it in Illustrator or Inkscape and tidy the paths before it
          goes to the router.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  loadImage,
  getImageData,
  adaptiveBinarize,
  addViewBox,
  downloadSVG,
  vectorFilename,
  SILHOUETTE_OPTIONS,
  DEFAULT_SENSITIVITY
} from '@/utils/vectorize'
import ImageTracer from 'imagetracerjs'
import { showToast } from '@/utils/toast'

const props = defineProps({
  src: { type: String, required: true },
  label: { type: String, default: '' },
  clientName: { type: String, default: '' }
})
defineEmits(['close'])

const sensitivity = ref(DEFAULT_SENSITIVITY)
const invert = ref(false)
const svg = ref('')
const tracing = ref(true)
const pathCount = ref(0)
let imageData = null

// Re-tracing on every slider tick would lock the UI up on a large mockup, so the trace is
// driven by @change (pointer release) and this guard, not by every intermediate value.
let pending = false

const retrace = async () => {
  if (!imageData || pending) return
  pending = true
  tracing.value = true
  // Let the spinner paint before the synchronous trace blocks the main thread.
  await new Promise((r) => setTimeout(r, 16))
  try {
    const mask = adaptiveBinarize(imageData, sensitivity.value, invert.value)
    const result = addViewBox(ImageTracer.imagedataToSVG(mask, SILHOUETTE_OPTIONS))
    svg.value = result
    pathCount.value = (result.match(/<path/g) || []).length
  } catch (err) {
    console.error('[VectorizeModal] trace failed', err)
    showToast('Could not trace this image.', 'error')
  } finally {
    tracing.value = false
    pending = false
  }
}

const resetAuto = () => {
  sensitivity.value = DEFAULT_SENSITIVITY
  invert.value = false
  retrace()
}

const download = () => {
  if (!svg.value) return
  downloadSVG(svg.value, vectorFilename(props.clientName, props.label))
  showToast('Vector outline downloaded', 'success', 3000)
}

onMounted(async () => {
  try {
    const img = await loadImage(props.src)
    imageData = getImageData(img)
    await retrace()
  } catch (err) {
    console.error('[VectorizeModal] could not load image', err)
    showToast('Could not load this image for vectorizing.', 'error')
    tracing.value = false
  }
})
</script>

<style scoped>
.vec-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
  backdrop-filter: blur(3px);
}
.vec-modal {
  background: #14181f; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px;
  width: min(920px, 94vw); max-height: 92vh; overflow: auto; color: #e6edf3;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.vec-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.vec-header h3 { margin: 0; font-size: 15px; font-weight: 700; }
.vec-sub { margin: 2px 0 0; font-size: 11px; color: #8b97a6; }
.vec-close {
  background: transparent; border: none; color: #8b97a6; cursor: pointer; font-size: 15px;
}
.vec-close:hover { color: #fff; }

.vec-body { display: flex; gap: 12px; padding: 14px 18px; }
.vec-panel { flex: 1; min-width: 0; }
.vec-panel-label {
  display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: #8b97a6; margin-bottom: 5px; font-weight: 700;
}
.vec-stage {
  height: 240px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.vec-stage-dark { background: #0b0e13; }
.vec-stage-light { background: #ffffff; }
.vec-preview-img { max-width: 100%; max-height: 100%; object-fit: contain; }
.vec-svg-holder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.vec-svg-holder :deep(svg) { max-width: 100%; max-height: 240px; height: auto; width: auto; }
.vec-spinner { color: #4b5a6b; font-size: 22px; }

.vec-controls { padding: 0 18px 16px; }
.vec-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.vec-row label { font-size: 11px; color: #8b97a6; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; }
.vec-row input[type='range'] { flex: 1; accent-color: #22d3ee; }
.vec-val { font-size: 12px; font-weight: 700; color: #22d3ee; width: 30px; text-align: right; }
.vec-row-actions { justify-content: flex-end; gap: 12px; }
.vec-check { display: flex; align-items: center; gap: 6px; cursor: pointer; margin-right: auto; }
.vec-check input { accent-color: #22d3ee; cursor: pointer; }
.vec-check span { font-size: 11px; color: #8b97a6; text-transform: uppercase; font-weight: 700; }
.vec-stat { font-size: 11px; color: #6b7785; }
.vec-btn-reset {
  background: transparent; color: #8b97a6; border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px; padding: 5px 12px; font-size: 11px; font-weight: 700; cursor: pointer;
  text-transform: uppercase;
}
.vec-btn-reset:hover { color: #fff; border-color: rgba(255, 255, 255, 0.4); }
.vec-btn-download {
  background: #22d3ee; color: #04222a; border: none; border-radius: 5px;
  padding: 6px 14px; font-size: 11px; font-weight: 800; cursor: pointer; text-transform: uppercase;
  display: flex; align-items: center; gap: 6px;
}
.vec-btn-download:hover:not(:disabled) { background: #67e8f9; }
.vec-btn-download:disabled { opacity: 0.5; cursor: default; }
.vec-hint { font-size: 11px; color: #6b7785; margin: 0; line-height: 1.5; }
</style>

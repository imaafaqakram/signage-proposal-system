<template>
  <div>
    <!-- Instructions and Delivery -->
    <div class="mt-8 theme-border-b pt-4 border-t-2">
      <div class="flex gap-6 text-[10px] theme-text-muted">
        <div class="w-1/2">
          <h5 class="font-bold mb-1" style="color: inherit">INSTRUCTIONS:</h5>
          <ul class="list-disc pl-3 space-y-0.5" style="list-style-type: disc;">
            <li>
              <input 
                :value="footer.instruction1" 
                @input="$emit('update:instruction1', $event.target.value)"
                class="editable-input"
              />
            </li>
            <li>
              <input 
                :value="footer.instruction2" 
                @input="$emit('update:instruction2', $event.target.value)"
                class="editable-input"
              />
            </li>
            <li>
              <input 
                :value="footer.instruction3" 
                @input="$emit('update:instruction3', $event.target.value)"
                class="editable-input font-bold theme-text-accent"
              />
            </li>
          </ul>
        </div>
        <div class="w-1/2">
          <p class="mb-1">
            Delivery: 
            <input 
              :value="footer.delivery" 
              @input="$emit('update:delivery', $event.target.value)"
              class="editable-input inline-block w-40 font-bold"
            />
          </p>
          <textarea 
            :value="footer.note" 
            @input="$emit('update:note', $event.target.value)"
            class="editable-input italic leading-tight w-full h-12 resize-none"
          ></textarea>
        </div>
      </div>
    </div>

    <!-- Copyright Notice -->
    <div class="mt-6 text-center">
      <div class="inline-block theme-card theme-text-accent text-[10px] font-black px-4 py-1 uppercase tracking-widest mb-1 shadow-sm border border-current" style="border-width: 0.5px">
        COPYRIGHT NOTICE
      </div>
      <div 
        class="text-[9px] italic theme-text-muted max-w-2xl mx-auto leading-tight opacity-80"
        v-html="settings.copyrightText"
      ></div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  footer: {
    type: Object,
    required: true
  },
  settings: {
    type: Object,
    required: true
  }
})

defineEmits(['update:instruction1', 'update:instruction2', 'update:instruction3', 'update:delivery', 'update:note'])
</script>

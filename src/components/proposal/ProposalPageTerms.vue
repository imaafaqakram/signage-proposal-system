<template>
  <!-- Static terms & policy page, always appended as the last page of every proposal.
       Content sourced from signagecrafting.com's actual Terms of Service, Refund
       Policy, and Shipping Policy — condensed to what a customer needs before
       approving a signage order, not the full website legal text. -->
  <div class="terms-page-landscape proposal-page terms-page" :class="[theme]" :style="customThemeStyle">
    <div class="terms-topbar">
      <h1 class="terms-brand">Signage<span class="terms-brand-accent">Crafting</span></h1>
      <div class="terms-topbar-right">
        <span><i class="fas fa-phone"></i> {{ proposalPhone }}</span>
        <span><i class="fas fa-envelope"></i> info@signagecrafting.com</span>
      </div>
    </div>

    <h2 class="terms-title">Terms &amp; Policies</h2>
    <p class="terms-subtitle">Please review before approving your proposal. Full policies at signagecrafting.com.</p>

    <div class="terms-grid">
      <section class="terms-card">
        <h3>Approval &amp; Proofing</h3>
        <p>Your final digital proof and specification sheet represent exactly what will be built. Review spelling, dimensions, fonts, mounting positions, and illuminated elements carefully — once approved, we're released from liability for design or layout errors on that proof.</p>
      </section>

      <section class="terms-card">
        <h3>Order Cancellation</h3>
        <table class="terms-table">
          <tbody>
            <tr><td>Pre-design</td><td>$15 + 5%</td></tr>
            <tr><td>Design &amp; proofing</td><td>20%</td></tr>
            <tr><td>Production active</td><td>50%+, not guaranteed</td></tr>
            <tr><td>Completed / shipped</td><td>Non-refundable</td></tr>
          </tbody>
        </table>
        <p class="terms-note">Rush/expedite fees are non-refundable under all circumstances.</p>
      </section>

      <section class="terms-card">
        <h3>Delivery &amp; Damage Claims</h3>
        <p>Inspect all packages on arrival. Report any transit damage within <strong>48 hours</strong> of delivery to info@signagecrafting.com with photos of the product, interior packaging, and exterior box. Our remedy is repair or replacement of the affected component — not a refund.</p>
      </section>

      <section class="terms-card">
        <h3>Shipping &amp; Timelines</h3>
        <p>Free worldwide shipping. Standard production + delivery is approximately <strong>13–17 working days</strong> after proof approval; all dates are estimates, not guarantees. International customers are responsible for customs duties and import taxes.</p>
      </section>

      <section class="terms-card">
        <h3>Permits</h3>
        <p>Permit timelines are not guaranteed. Government, municipal, or zoning fees required to install or display your sign are the client's responsibility unless stated otherwise. We assume no liability for signs fined, rejected, or removed by local authorities.</p>
      </section>

      <section class="terms-card">
        <h3>Warranty</h3>
        <p><strong>1-year limited warranty</strong> on manufacturing defects and internal electrical components (LEDs, power supplies, wiring). Submit photo/video evidence of the fault for verification. Excludes damage from improper installation, misuse, vandalism, unauthorized modification, or normal weathering.</p>
      </section>

      <section class="terms-card">
        <h3>Color &amp; Material Accuracy</h3>
        <p>Color reproduction is guaranteed within 90% of the approved digital proof; exact color and LED intensity can vary by screen and material. Minor texture or seam variations are inherent to handcrafted manufacturing and are not defects.</p>
      </section>

      <section class="terms-card">
        <h3>Liability &amp; Disputes</h3>
        <p>Our liability is limited to repairing or replacing defective components — not indirect, incidental, or consequential damages (lost business, missed deadlines, third-party costs). Disputes must be raised in writing within 2 business days of delivery; please contact us before initiating a chargeback.</p>
      </section>
    </div>

    <div class="terms-footer">
      <p><strong>All custom orders are final</strong> once production begins — see the cancellation schedule above for what's recoverable before then.</p>
      <p class="terms-copyright">© {{ new Date().getFullYear() }} Signage Crafting. Questions: <a href="mailto:info@signagecrafting.com">info@signagecrafting.com</a>.</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useProposalTheme } from '@/composables/useProposalTheme'
import { usePublicSettings } from '@/composables/usePublicSettings'

const { proposalPhone } = usePublicSettings()

const props = defineProps({
  theme: { type: String, default: '' },
  settings: { type: Object, default: null }
})

// Same shared logic every other page template uses — without this, this page stayed
// frozen on hardcoded colors, ignoring whatever the client actually picked.
const customThemeStyle = useProposalTheme(computed(() => props.settings))
</script>

<style scoped>
/* Landscape to match every company page template (.sc-page / .nl-page are already
   297x210mm) — previously this page used the shared portrait .a4-page (210x297mm), so
   the downloaded PDF ended with two differently-shaped pages back to back. */
.terms-page-landscape {
  width: 297mm;
  min-height: 210mm;
  max-height: 210mm;
  padding: 10mm 14mm;
  margin: 0 auto 30px auto;
  overflow: hidden;
  position: relative;
  background: var(--page-bg, #0a0a0a);
  color: var(--text-main);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
}

.terms-page {
  font-size: 11.5px;
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.terms-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border-color);
}

.terms-brand {
  font-size: 20px;
  font-weight: 800;
  margin: 0;
  color: var(--text-main);
}

.terms-brand-accent {
  color: var(--text-accent);
}

.terms-topbar-right {
  display: flex;
  gap: 16px;
  font-size: 11px;
  color: var(--text-muted);
}

.terms-topbar-right i {
  margin-right: 4px;
  color: var(--text-accent);
}

.terms-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--text-main);
}

.terms-subtitle {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0 0 16px;
}

.terms-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  flex: 1;
  align-content: start;
}

.terms-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 12px;
}

.terms-card h3 {
  font-size: 12px;
  font-weight: 700;
  margin: 0 0 6px;
  color: var(--text-accent);
}

.terms-card p {
  margin: 0;
  color: var(--text-muted);
}

.terms-note {
  margin-top: 6px !important;
  font-style: italic;
  font-size: 10px;
}

.terms-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10.5px;
  margin-bottom: 2px;
}

.terms-table td {
  padding: 3px 0;
  color: var(--text-muted);
  border-bottom: 1px dashed var(--border-color);
}

.terms-table td:last-child {
  text-align: right;
  color: var(--text-main);
  font-weight: 600;
}

.terms-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  text-align: center;
}

.terms-footer p {
  margin: 0 0 4px;
  color: var(--text-muted);
  font-size: 10.5px;
}

.terms-copyright a {
  color: var(--text-accent);
  text-decoration: none;
}
</style>

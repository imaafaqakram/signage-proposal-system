/**
 * Toast Notification System
 * Professional feedback for user actions
 */

let toastContainer = null

// Initialize toast container
const initToastContainer = () => {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.className = 'toast-container'
    document.body.appendChild(toastContainer)
  }
  return toastContainer
}

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - success, error, info, warning
 * @param {number} duration - How long to show (ms)
 */
export const showToast = (message, type = 'success', duration = 3000) => {
  const container = initToastContainer()

  const toast = document.createElement('div')
  toast.className = `toast-notification toast-${type}`

  // Icon based on type
  const icons = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    info: 'fa-info-circle',
    warning: 'fa-exclamation-triangle'
  }

  toast.innerHTML = `
    <i class="fas ${icons[type]}"></i>
    <span class="toast-message">${message}</span>
  `

  container.appendChild(toast)

  // Animate in
  setTimeout(() => {
    toast.classList.add('toast-show')
  }, 10)

  // Auto remove
  setTimeout(() => {
    toast.classList.remove('toast-show')
    setTimeout(() => {
      container.removeChild(toast)
      // Remove container if empty
      if (container.children.length === 0) {
        document.body.removeChild(container)
        toastContainer = null
      }
    }, 300)
  }, duration)
}

/**
 * Confirm action with custom dialog
 * @param {string} message - Confirmation message
 * @param {string} confirmText - Text for confirm button
 * @returns {Promise<boolean>}
 */
export const confirmAction = (message, confirmText = 'Confirm') => {
  return new Promise((resolve) => {
    const modal = document.createElement('div')
    modal.className = 'confirm-modal'

    modal.innerHTML = `
      <div class="confirm-modal-backdrop"></div>
      <div class="confirm-modal-content">
        <i class="fas fa-question-circle confirm-icon"></i>
        <p class="confirm-message">${message}</p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel">Cancel</button>
          <button class="confirm-btn confirm-ok">${confirmText}</button>
        </div>
      </div>
    `

    document.body.appendChild(modal)

    // Add show class for animation
    setTimeout(() => modal.classList.add('confirm-show'), 10)

    const handleResponse = (confirmed) => {
      modal.classList.remove('confirm-show')
      setTimeout(() => {
        document.body.removeChild(modal)
        resolve(confirmed)
      }, 300)
    }

    modal.querySelector('.confirm-cancel').onclick = () => handleResponse(false)
    modal.querySelector('.confirm-ok').onclick = () => handleResponse(true)
    modal.querySelector('.confirm-modal-backdrop').onclick = () => handleResponse(false)
  })
}

/**
 * Show loading overlay
 * @param {string} message - Loading message
 * @returns {string} - Loading ID to use with hideLoading
 */
let loadingId = 0
const loadingOverlays = {}

export const showLoading = (message = 'Loading...') => {
  const id = `loading-${++loadingId}`
  const loading = document.createElement('div')
  loading.className = 'loading-overlay'
  loading.id = id

  loading.innerHTML = `
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <p class="loading-message">${message}</p>
    </div>
  `

  document.body.appendChild(loading)
  setTimeout(() => loading.classList.add('loading-show'), 10)

  loadingOverlays[id] = loading
  return id
}

/**
 * Hide loading overlay
 * @param {string} id - Loading ID from showLoading
 */
export const hideLoading = (id) => {
  const loading = loadingOverlays[id]
  if (loading) {
    loading.classList.remove('loading-show')
    setTimeout(() => {
      if (document.body.contains(loading)) {
        document.body.removeChild(loading)
      }
      delete loadingOverlays[id]
    }, 300)
  }
}

// CSS styles (added to global styles)
export const toastStyles = `
/* Toast Container */
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

/* Toast Notification */
.toast-notification {
  min-width: 300px;
  padding: 16px 24px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: white;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  opacity: 0;
  transform: translateX(400px);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: auto;
}

.toast-notification.toast-show {
  opacity: 1;
  transform: translateX(0);
}

.toast-notification i {
  font-size: 20px;
  flex-shrink: 0;
}

.toast-success {
  background: linear-gradient(135deg, #10b981, #059669);
}

.toast-error {
  background: linear-gradient(135deg, #ef4444, #dc2626);
}

.toast-info {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
}

.toast-warning {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

/* Confirm Modal */
.confirm-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.confirm-modal.confirm-show {
  opacity: 1;
}

.confirm-modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.confirm-modal-content {
  position: relative;
  background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 32px;
  max-width: 400px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  transform: scale(0.9);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.confirm-modal.confirm-show .confirm-modal-content {
  transform: scale(1);
}

.confirm-icon {
  font-size: 48px;
  color: #f59e0b;
  margin-bottom: 16px;
}

.confirm-message {
  color: #e5e7eb;
  font-size: 16px;
  margin-bottom: 24px;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.confirm-btn {
  padding: 10px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.confirm-cancel {
  background: rgba(255, 255, 255, 0.1);
  color: #9ca3af;
}

.confirm-cancel:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

.confirm-ok {
  background: linear-gradient(135deg, #22d3ee, #0ea5e9);
  color: white;
}

.confirm-ok:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(34, 211, 238, 0.4);
}

/* Loading Overlay */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.loading-overlay.loading-show {
  opacity: 1;
}

.loading-content {
  text-align: center;
}

.loading-spinner {
  width: 60px;
  height: 60px;
  border: 4px solid rgba(34, 211, 238, 0.3);
  border-top-color: #22d3ee;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 20px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-message {
  color: white;
  font-size: 16px;
  font-weight: 500;
}
`

import { CartAddEvent } from '@theme/events';

const ADDED_STATE_DURATION = 2500;

/**
 * Compact add-on upsell under the add to cart button.
 * Adds its own product to the cart, independently of the main product form.
 */
class ProductUpsellComponent extends HTMLElement {
  /** @type {number | undefined} */
  #timeout;

  connectedCallback() {
    this.button?.addEventListener('click', this.#onAdd);
    this.select?.addEventListener('change', this.#onVariantChange);
  }

  disconnectedCallback() {
    this.button?.removeEventListener('click', this.#onAdd);
    this.select?.removeEventListener('change', this.#onVariantChange);
    clearTimeout(this.#timeout);
  }

  /** @returns {HTMLButtonElement | null} */
  get button() {
    return this.querySelector('[ref="button"]');
  }

  /** @returns {HTMLSelectElement | null} */
  get select() {
    return this.querySelector('[ref="variantSelect"]');
  }

  #onVariantChange = () => {
    const option = this.select?.selectedOptions[0];
    const button = this.button;
    if (!option || !button) return;

    button.dataset.variantId = option.value;
    button.disabled = option.disabled;
    button.classList.remove('is-added');
    button.textContent = option.disabled ? button.dataset.soldOutLabel ?? '' : button.dataset.label ?? '';

    const price = this.querySelector('[ref="price"]');
    if (price) price.textContent = option.dataset.price ?? '';

    const compare = this.querySelector('[ref="compare"]');
    if (compare) {
      compare.textContent = option.dataset.compare ?? '';
      compare.classList.toggle('hidden', !option.dataset.compare);
    }

    const image = /** @type {HTMLImageElement | null} */ (this.querySelector('[ref="image"]'));
    if (image && option.dataset.image) {
      image.removeAttribute('srcset');
      image.src = option.dataset.image;
    }
  };

  #onAdd = async () => {
    const button = this.button;
    const variantId = Number(button?.dataset.variantId);
    if (!button || !variantId || button.getAttribute('aria-busy') === 'true') return;

    button.setAttribute('aria-busy', 'true');
    this.#setError('');

    try {
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
      });
      const result = await response.json();

      if (!response.ok || result.status) {
        this.#setError(result.description || result.message || 'Error');
        return;
      }

      const cart = await fetch(`${Theme.routes.cart_url}.js`).then((res) => res.json());
      this.#dispatchCartUpdate(variantId, cart.item_count);
      this.#showAdded(button);
    } catch (error) {
      console.error(error);
      this.#setError('Error');
    } finally {
      button.removeAttribute('aria-busy');
    }
  };

  /**
   * Notifies the theme (cart icon, cart drawer contents) that the cart changed.
   * @param {number} variantId
   * @param {number} itemCount
   */
  #dispatchCartUpdate(variantId, itemCount) {
    const event = new CartAddEvent({}, String(variantId), {
      source: 'product-upsell',
      itemCount,
      variantId: String(variantId),
    });

    // The cart drawer opens on every cart update when it has `auto-open`.
    // Suppress that for this dispatch unless the block is set to open it.
    const drawer = document.querySelector('cart-drawer-component[auto-open]');
    const suppressDrawer = drawer && this.dataset.openCart !== 'true';
    if (suppressDrawer) drawer.removeAttribute('auto-open');

    try {
      this.dispatchEvent(event);
    } finally {
      if (suppressDrawer) drawer.setAttribute('auto-open', '');
    }

    if (!drawer && this.dataset.openCart === 'true') {
      /** @type {any} */ (document.querySelector('cart-drawer-component'))?.open?.();
    }
  }

  /** @param {HTMLButtonElement} button */
  #showAdded(button) {
    button.classList.add('is-added');
    button.textContent = button.dataset.addedLabel ?? '';
    clearTimeout(this.#timeout);
    this.#timeout = setTimeout(() => {
      button.classList.remove('is-added');
      button.textContent = button.dataset.label ?? '';
    }, ADDED_STATE_DURATION);
  }

  /** @param {string} message */
  #setError(message) {
    const error = this.querySelector('[ref="error"]');
    if (!error) return;
    error.textContent = message;
    error.classList.toggle('hidden', !message);
  }
}

if (!customElements.get('product-upsell-component')) {
  customElements.define('product-upsell-component', ProductUpsellComponent);
}

import { CartAddEvent, ThemeEvents } from '@theme/events';

const SOURCE = 'product-upsell';

/**
 * Kaching-style add-on row with an on/off switch.
 * On adds one unit of the product to the cart, off removes it.
 * Works independently of the main product form.
 */
class ProductUpsellComponent extends HTMLElement {
  #busy = false;

  connectedCallback() {
    this.card?.addEventListener('click', this.#onCardClick);
    this.select?.addEventListener('change', this.#onVariantChange);
    document.addEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate);
    this.#syncWithCart();
  }

  disconnectedCallback() {
    this.card?.removeEventListener('click', this.#onCardClick);
    this.select?.removeEventListener('change', this.#onVariantChange);
    document.removeEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate);
  }

  get card() {
    return this.querySelector('[ref="card"]');
  }

  /** @returns {HTMLButtonElement | null} */
  get switch() {
    return this.querySelector('[ref="switch"]');
  }

  /** @returns {HTMLSelectElement | null} */
  get select() {
    return this.querySelector('[ref="variantSelect"]');
  }

  get variantId() {
    return Number(this.dataset.variantId);
  }

  get isOn() {
    return this.switch?.getAttribute('aria-checked') === 'true';
  }

  /** @param {boolean} on */
  #setOn(on) {
    this.switch?.setAttribute('aria-checked', String(on));
    this.classList.toggle('is-active', on);
  }

  /** @param {MouseEvent} event */
  #onCardClick = (event) => {
    // Let the variant picker work without toggling the switch
    if (event.target instanceof Element && event.target.closest('select')) return;
    if (this.switch?.disabled) return;
    this.#toggle();
  };

  #onVariantChange = async () => {
    const option = this.select?.selectedOptions[0];
    if (!option) return;

    // Swap the variant in the cart if the add-on is currently on
    const wasOn = this.isOn;
    if (wasOn) await this.#remove();

    this.dataset.variantId = option.value;
    if (this.switch) this.switch.disabled = option.disabled;
    this.classList.toggle('is-disabled', option.disabled);

    const subtitle = /** @type {HTMLElement | null} */ (this.querySelector('[ref="subtitle"]'));
    if (subtitle) {
      const text = option.disabled ? subtitle.dataset.soldOut : subtitle.dataset.subtitle;
      subtitle.textContent = text ?? '';
      subtitle.classList.toggle('hidden', !text);
    }

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

    if (wasOn && !option.disabled) await this.#add();
  };

  /** Keeps the switch in sync when the cart changes elsewhere (e.g. item removed in the cart drawer). */
  /** @param {Event} event */
  #onCartUpdate = (event) => {
    const detail = /** @type {CustomEvent} */ (event).detail;
    if (detail?.data?.source === SOURCE || this.#busy) return;
    this.#syncWithCart();
  };

  async #syncWithCart() {
    try {
      const cart = await this.#fetchCart();
      this.#setOn(cart.items.some((/** @type {any} */ item) => item.variant_id === this.variantId));
    } catch (error) {
      console.error(error);
    }
  }

  async #toggle() {
    if (this.#busy) return;
    const turnOn = !this.isOn;

    // Update the UI right away, revert if the request fails
    this.#setOn(turnOn);
    const ok = turnOn ? await this.#add() : await this.#remove();
    if (!ok) this.#setOn(!turnOn);
  }

  async #add() {
    return this.#request(async () => {
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: this.variantId, quantity: 1 }] }),
      });
      const result = await response.json();
      if (!response.ok || result.status) throw new Error(result.description || result.message);

      const cart = await this.#fetchCart();
      return cart.item_count;
    }, this.dataset.openCart === 'true');
  }

  async #remove() {
    return this.#request(async () => {
      const cart = await this.#fetchCart();
      const item = cart.items.find((/** @type {any} */ i) => i.variant_id === this.variantId);
      if (!item) return cart.item_count;

      const response = await fetch(`${Theme.routes.cart_change_url}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: item.key, quantity: item.quantity - 1 }),
      });
      const result = await response.json();
      if (!response.ok || result.status) throw new Error(result.description || result.message);
      return result.item_count;
    }, false);
  }

  /**
   * Runs a cart request, then tells the theme (cart icon, cart drawer) that the cart changed.
   * @param {() => Promise<number>} run - Returns the new cart item count
   * @param {boolean} openDrawer
   */
  async #request(run, openDrawer) {
    this.#busy = true;
    this.switch?.setAttribute('aria-busy', 'true');
    this.#setError('');

    try {
      const itemCount = await run();
      this.#dispatchCartUpdate(itemCount, openDrawer);
      return true;
    } catch (error) {
      console.error(error);
      this.#setError(error instanceof Error && error.message ? error.message : 'Error');
      return false;
    } finally {
      this.#busy = false;
      this.switch?.removeAttribute('aria-busy');
    }
  }

  /**
   * @param {number} itemCount
   * @param {boolean} openDrawer
   */
  #dispatchCartUpdate(itemCount, openDrawer) {
    const event = new CartAddEvent({}, String(this.variantId), {
      source: SOURCE,
      itemCount,
      variantId: String(this.variantId),
    });

    // The cart drawer opens on every cart update when it has `auto-open`: suppress that unless asked for
    const drawer = document.querySelector('cart-drawer-component[auto-open]');
    const suppressDrawer = drawer && !openDrawer;
    if (suppressDrawer) drawer.removeAttribute('auto-open');

    try {
      this.dispatchEvent(event);
    } finally {
      if (suppressDrawer) drawer.setAttribute('auto-open', '');
    }

    if (!drawer && openDrawer) {
      /** @type {any} */ (document.querySelector('cart-drawer-component'))?.open?.();
    }
  }

  async #fetchCart() {
    const response = await fetch(`${Theme.routes.cart_url}.js`, { headers: { Accept: 'application/json' } });
    return response.json();
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

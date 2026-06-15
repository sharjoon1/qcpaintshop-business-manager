// Engineer cart controller. Externalized from the page inline <script>
// (S9+F5 Phase C batch 2, 2026-06-15) so engineer-cart.html runs under the enforced strict CSP.
// Depends on window.EP (engineer-portal.js, loaded just before). Verbatim move — no logic change.
    (function () {
      var emptyEl = document.getElementById('emptyState');
      var cartEl  = document.getElementById('cartView');
      var successEl = document.getElementById('successState');

      function render() {
        var cart = EP.cart.read();
        var n = cart.items.length;
        document.getElementById('cartLinesTitle').textContent = 'Line Items · ' + n + (n === 1 ? ' SKU' : ' SKUs');

        if (!n) {
          emptyEl.style.display = '';
          cartEl.style.display  = 'none';
          return;
        }
        emptyEl.style.display = 'none';
        cartEl.style.display  = 'grid';

        var rows = document.getElementById('lineRows');
        rows.innerHTML = cart.items.map(function (it) {
          var img = it.image_url
            ? '<img src="' + EP.escapeHTML(it.image_url) + '" alt="">'
            : '<div class="ph">' + EP.escapeHTML((it.product_name || '').slice(0, 14)) + '</div>';
          var hasDisc = parseFloat(it.discount_pct) > 0;
          var qty = parseInt(it.quantity, 10) || 0;
          var lineTotal = parseFloat(it.effective_rate || 0) * qty;
          return '<div class="cart-line">'
            + '<div class="cart-thumb">' + img + '</div>'
            + '<div class="cart-info">'
            +   (it.brand ? '<div class="brand">' + EP.escapeHTML(it.brand) + '</div>' : '')
            +   '<div class="name">' + EP.escapeHTML(it.product_name) + '</div>'
            +   '<div class="meta">' + EP.escapeHTML(it.size_label || it.zoho_item_name || '') + (it.color_name ? ' · ' + EP.escapeHTML(it.color_name) : '') + ' · <span class="ep-text-mono">' + EP.escapeHTML(it.zoho_item_id || '') + '</span></div>'
            + '</div>'
            + '<div class="col-rate">'
            +   '<strong>' + EP.fmtINR(it.effective_rate) + '</strong>'
            +   (hasDisc ? '<span class="was">' + EP.fmtINR(it.list_rate) + '</span>' : '')
            +   (hasDisc ? '<span class="disc">' + it.discount_pct + '% off</span>' : '')
            + '</div>'
            + '<div class="col-qty">'
            +   '<div class="qty-stepper">'
            +     '<button type="button" data-step="-1" data-pid="' + it.pack_size_id + '">−</button>'
            +     '<input type="number" min="1" max="9999" value="' + qty + '" data-qty data-pid="' + it.pack_size_id + '">'
            +     '<button type="button" data-step="+1" data-pid="' + it.pack_size_id + '">+</button>'
            +   '</div>'
            + '</div>'
            + '<div class="col-line">' + EP.fmtINR(lineTotal) + '</div>'
            + '<div class="col-rm"><button type="button" data-remove="' + it.pack_size_id + '">Remove</button></div>'
            + '</div>';
        }).join('');

        // Wire row controls
        rows.querySelectorAll('[data-step]').forEach(function (b) {
          b.addEventListener('click', function () {
            var pid = parseInt(b.dataset.pid, 10);
            var step = parseInt(b.dataset.step, 10);
            var c = EP.cart.read();
            var f = c.items.find(function (it) { return it.pack_size_id === pid; });
            if (!f) return;
            EP.cart.setQty(pid, (parseInt(f.quantity, 10) || 1) + step);
            render();
          });
        });
        rows.querySelectorAll('[data-qty]').forEach(function (inp) {
          inp.addEventListener('change', function () {
            var pid = parseInt(inp.dataset.pid, 10);
            EP.cart.setQty(pid, parseInt(inp.value, 10));
            render();
          });
        });
        rows.querySelectorAll('[data-remove]').forEach(function (rm) {
          rm.addEventListener('click', function () {
            var pid = parseInt(rm.dataset.remove, 10);
            EP.cart.remove(pid);
            render();
            EP.toast('Item removed from cart.');
          });
        });

        // Totals
        var subList = 0, subNet = 0;
        cart.items.forEach(function (it) {
          var q = parseInt(it.quantity, 10) || 0;
          subList += parseFloat(it.list_rate || 0) * q;
          subNet  += parseFloat(it.effective_rate || it.list_rate || 0) * q;
        });
        var savings = subList - subNet;
        document.getElementById('totalList').textContent = EP.fmtINR(subList);
        document.getElementById('totalNet').textContent  = EP.fmtINR(subNet);
        if (savings > 0) {
          document.getElementById('savingsRow').style.display = '';
          document.getElementById('totalSavings').textContent = '–' + EP.fmtINR(savings);
        } else {
          document.getElementById('savingsRow').style.display = 'none';
        }
      }

      document.getElementById('clearAllBtn').addEventListener('click', function () {
        if (!confirm('Remove all items from the cart?')) return;
        EP.cart.clear();
        render();
        EP.toast('Cart cleared.');
      });

      document.getElementById('submitBtn').addEventListener('click', async function () {
        var btn = this;
        var project = document.getElementById('coProject').value.trim();
        var location = document.getElementById('coLocation').value.trim();
        var notes = document.getElementById('coNotes').value.trim();
        if (!project) { EP.toast('Project name is required.', 'err'); document.getElementById('coProject').focus(); return; }
        if (!location) { EP.toast('Site / delivery address is required.', 'err'); document.getElementById('coLocation').focus(); return; }
        btn.disabled = true; btn.textContent = 'Submitting…';
        try {
          var data = await EP.cart.submit({ project_name: project, location: location, additional_notes: notes });
          // PAGE-310: cart.submit returns null on a swallowed 401/403 (e.g. pending/suspended engineer).
          // Don't bail silently — tell the user why nothing happened.
          if (!data) { EP.toast('Could not submit — your engineer account may be pending approval, or your session expired. Please sign in again.', 'err'); return; }
          document.getElementById('cartView').style.display = 'none';
          document.getElementById('emptyState').style.display = 'none';
          document.getElementById('successRef').textContent = data.request_number || '—';
          successEl.style.display = '';
          document.getElementById('cartPageSub').textContent = 'Your order has been submitted to our project estimator.';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          EP.toast(err.message || 'Submission failed.', 'err');
        } finally {
          btn.disabled = false; btn.textContent = 'Submit Order Request';
        }
      });

      document.addEventListener('ep:cart-changed', render);
      document.addEventListener('DOMContentLoaded', function () {
        EP.loadMe();
        render();
      });
    })();

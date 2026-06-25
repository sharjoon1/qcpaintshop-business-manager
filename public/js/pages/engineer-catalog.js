// Engineer catalogue controller. Externalized from the page inline <script>
// (S9+F5 Phase C batch 3, 2026-06-25) so engineer-catalog.html runs under the enforced strict CSP.
// Depends on window.EP (engineer-portal.js, loaded just before). Verbatim move - no logic change;
// the one runtime-injected card handler (formerly an inline openDetail call) is now data-action delegation.
    (function () {
      var state = { page: 1, limit: 24, total: 0, search: '', brand: '', category: '' };

      async function loadFilters() {
        try {
          var r = await fetch(EP.API_BASE + '/me/catalog-filters', { headers: EP.authHeaders() });
          if (EP.handleAuthFail(r)) return;
          var data = await r.json();
          if (!data.success) return;
          var b = document.getElementById('qBrand');
          var c = document.getElementById('qCategory');
          (data.brands || []).forEach(function (br) {
            var o = document.createElement('option'); o.value = br; o.textContent = br; b.appendChild(o);
          });
          (data.categories || []).forEach(function (cat) {
            var o = document.createElement('option'); o.value = cat; o.textContent = cat; c.appendChild(o);
          });
        } catch (e) { console.error(e); }
      }

      async function loadCatalog() {
        var grid = document.getElementById('qGrid');
        var meta = document.getElementById('qMeta');
        meta.textContent = 'Loading…';
        try {
          var params = new URLSearchParams();
          params.set('page', state.page);
          params.set('limit', state.limit);
          if (state.search) params.set('search', state.search);
          if (state.brand) params.set('brand', state.brand);
          if (state.category) params.set('category', state.category);
          var r = await fetch(EP.API_BASE + '/me/catalog?' + params.toString(), { headers: EP.authHeaders() });
          if (EP.handleAuthFail(r)) return;
          var data = await r.json();
          if (!data.success) throw new Error(data.message || 'Failed');
          state.total = data.total || 0;

          if (!data.products.length) {
            grid.innerHTML = '<div style="grid-column:1/-1;background:var(--ep-panel);border:1px solid var(--ep-border);border-radius:var(--ep-radius);"><div class="ep-empty"><div class="ep-empty-mark">No Match</div><h3>No products match this filter</h3><p>Adjust your search or filter selection.</p></div></div>';
            meta.textContent = '0 products';
            document.getElementById('qPager').style.display = 'none';
            return;
          }

          grid.innerHTML = data.products.map(function (p) {
            var hasDisc = p.discount_pct && p.discount_pct > 0;
            var listMin = parseFloat(p.list_min || 0), listMax = parseFloat(p.list_max || 0);
            var effMin = parseFloat(p.effective_min || 0), effMax = parseFloat(p.effective_max || 0);
            var listRange = listMin === listMax ? EP.fmtINR(listMin) : EP.fmtINR(listMin) + '–' + EP.fmtINR(listMax, false);
            var effRange  = effMin === effMax ? EP.fmtINR(effMin) : EP.fmtINR(effMin) + '–' + EP.fmtINR(effMax, false);
            var img = p.image_url
              ? '<img src="' + EP.escapeHTML(p.image_url) + '" alt="" loading="lazy">'
              : '<div class="fallback">' + EP.escapeHTML(p.name).slice(0, 28) + '</div>';
            var disc = hasDisc ? '<div class="cat-disc-tag">' + p.discount_pct + '% OFF</div>' : '';
            return '<article class="cat-card" data-action="open-detail" data-product-id="' + p.product_id + '">'
              + '<div class="cat-img">' + img + disc + '</div>'
              + '<div class="cat-body">'
              +   (p.brand ? '<div class="cat-brand">' + EP.escapeHTML(p.brand) + '</div>' : '')
              +   '<h3 class="cat-name">' + EP.escapeHTML(p.name) + '</h3>'
              +   '<div class="cat-price-row">'
              +     '<span class="cat-price-now' + (hasDisc ? ' is-disc' : '') + '">' + effRange + '</span>'
              +     (hasDisc ? '<span class="cat-price-was">' + listRange + '</span>' : '')
              +   '</div>'
              +   '<div class="cat-variants">' + (p.variant_count || 0) + ' pack size' + (p.variant_count === 1 ? '' : 's') + '</div>'
              + '</div></article>';
          }).join('');

          meta.textContent = state.total + ' product' + (state.total === 1 ? '' : 's');
          var pages = Math.max(1, Math.ceil(state.total / state.limit));
          var pager = document.getElementById('qPager');
          if (pages > 1) {
            pager.style.display = 'flex';
            document.getElementById('qPageInfo').textContent = 'Page ' + state.page + ' of ' + pages + ' · ' + state.total + ' products';
            document.getElementById('qPrev').disabled = state.page <= 1;
            document.getElementById('qNext').disabled = state.page >= pages;
          } else {
            pager.style.display = 'none';
          }
        } catch (e) {
          console.error(e);
          grid.innerHTML = '<div style="grid-column:1/-1;"><div class="ep-empty"><p>Unable to load catalogue. Please refresh.</p></div></div>';
          meta.textContent = '';
        }
      }

      window.openDetail = async function (id) {
        var modal = document.getElementById('dModal');
        var body = document.getElementById('dBody');
        document.getElementById('dName').textContent = 'Loading…';
        document.getElementById('dMeta').textContent = '';
        body.innerHTML = '<div class="ep-skel" style="height:200px"></div>';
        modal.classList.add('is-open');
        try {
          var r = await fetch(EP.API_BASE + '/me/catalog/' + id, { headers: EP.authHeaders() });
          if (EP.handleAuthFail(r)) return;
          var data = await r.json();
          if (!data.success) throw new Error(data.message || 'Not found');
          var p = data.product;
          var v = data.variants || [];
          document.getElementById('dName').textContent = p.name;
          var brand = v.length ? v[0].brand : '';
          var cat = v.length ? v[0].category : '';
          document.getElementById('dMeta').textContent = [brand, cat].filter(Boolean).join(' · ');

          var hasDisc = v.some(function (x) { return x.discount_pct > 0; });
          var notice = hasDisc
            ? '<div class="ep-notice ok">Your contracted engineer discount has been applied to the prices shown below.</div>'
            : '<div class="ep-notice warn">No contracted discount on record for these items. Contact your relationship manager to negotiate engineer rates.</div>';

          // Remember last fetched product for add-to-cart callback
          window.__currentProduct = p;
          window.__currentVariants = v;

          body.innerHTML = notice + '<table class="ep-table"><thead><tr>'
            + '<th>Item / Pack</th><th>Item Code</th><th class="num">List Price</th><th class="num">Your Price</th><th class="num">Discount</th><th class="num">Quantity</th><th style="text-align:right;">Action</th>'
            + '</tr></thead><tbody>'
            + v.map(function (x, idx) {
              var disc = x.discount_pct > 0;
              // PAGE-307: color_code goes into a CSS value, not HTML — escapeHTML is the wrong
              // escaper there. Allowlist hex / named colors; drop anything else (no CSS injection).
              var cc = (function (c) { c = String(c == null ? '' : c).trim(); return (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) || /^[a-zA-Z]{1,20}$/.test(c)) ? c : ''; })(x.color_code);
              var dot = cc ? '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:' + cc + ';border:1px solid rgba(0,0,0,0.1);vertical-align:middle;"></span>' : '';
              return '<tr data-variant-idx="' + idx + '">'
                + '<td>' + dot + '<b>' + EP.escapeHTML(x.size_label || x.zoho_item_name || '—') + '</b>' + (x.color_name ? ' <small>' + EP.escapeHTML(x.color_name) + '</small>' : '') + '</td>'
                + '<td class="mono">' + EP.escapeHTML(x.zoho_item_id || '') + '</td>'
                + '<td class="num">' + EP.fmtINR(x.list_rate) + '</td>'
                + '<td class="num"><b>' + EP.fmtINR(x.effective_rate) + '</b></td>'
                + '<td class="num" style="color:' + (disc ? 'var(--ep-green-2)' : 'var(--ep-muted)') + ';font-weight:600;">' + (disc ? x.discount_pct + '%' : '—') + '</td>'
                + '<td class="num">'
                +   '<div class="cat-qty-stepper" style="display:inline-flex;">'
                +     '<button type="button" data-step="-1">−</button>'
                +     '<input type="number" min="1" max="9999" value="1" data-qty>'
                +     '<button type="button" data-step="+1">+</button>'
                +   '</div>'
                + '</td>'
                + '<td style="text-align:right;">'
                +   '<button type="button" class="cat-add-btn" data-add-variant>+ Add</button>'
                + '</td>'
                + '</tr>';
            }).join('')
            + '</tbody></table>'
            + '<p style="font-size:11px;color:var(--ep-muted);margin-top:18px;">Prices exclude GST. For non-standard SKUs or bespoke specifications, submit a <a href="/engineer-new-quote.html" style="color:var(--ep-active);font-weight:500;">custom quotation request</a>.</p>';

          // Wire qty stepper + add buttons
          body.querySelectorAll('tr[data-variant-idx]').forEach(function (row) {
            var idx = parseInt(row.dataset.variantIdx, 10);
            var qtyInput = row.querySelector('[data-qty]');
            row.querySelectorAll('[data-step]').forEach(function (b) {
              b.addEventListener('click', function () {
                var step = parseInt(b.dataset.step, 10);
                var cur = parseInt(qtyInput.value, 10) || 1;
                qtyInput.value = Math.max(1, Math.min(9999, cur + step));
              });
            });
            qtyInput.addEventListener('input', function () {
              var cur = parseInt(qtyInput.value, 10);
              if (!Number.isFinite(cur) || cur < 1) qtyInput.value = 1;
              if (cur > 9999) qtyInput.value = 9999;
            });
            var addBtn = row.querySelector('[data-add-variant]');
            addBtn.addEventListener('click', function () {
              var qty = parseInt(qtyInput.value, 10) || 1;
              var variant = window.__currentVariants[idx];
              EP.cart.add({
                product_id:     window.__currentProduct.product_id,
                product_name:   window.__currentProduct.name,
                pack_size_id:   variant.pack_size_id,
                zoho_item_id:   variant.zoho_item_id,
                zoho_item_name: variant.zoho_item_name,
                size_label:     variant.size_label,
                color_name:     variant.color_name,
                brand:          variant.brand,
                category:       variant.category,
                image_url:      variant.image_url || null,
                list_rate:      variant.list_rate,
                effective_rate: variant.effective_rate,
                discount_pct:   variant.discount_pct
              }, qty);
              addBtn.classList.add('is-added');
              addBtn.textContent = '✓ Added';
              EP.toast(qty + ' × ' + (variant.size_label || variant.zoho_item_name) + ' added to cart.', 'ok');
              setTimeout(function () { addBtn.classList.remove('is-added'); addBtn.textContent = '+ Add'; qtyInput.value = 1; }, 1500);
            });
          });
        } catch (e) {
          body.innerHTML = '<div class="ep-empty"><p>Unable to load product details.</p></div>';
        }
      };

      document.getElementById('dClose').addEventListener('click', function () {
        document.getElementById('dModal').classList.remove('is-open');
      });
      document.getElementById('dModal').addEventListener('click', function (e) {
        if (e.target.id === 'dModal') this.classList.remove('is-open');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') document.getElementById('dModal').classList.remove('is-open');
      });

      var sTimer;
      document.getElementById('qSearch').addEventListener('input', function (e) {
        clearTimeout(sTimer);
        sTimer = setTimeout(function () { state.search = e.target.value.trim(); state.page = 1; loadCatalog(); }, 280);
      });
      document.getElementById('qBrand').addEventListener('change', function (e) { state.brand = e.target.value; state.page = 1; loadCatalog(); });
      document.getElementById('qCategory').addEventListener('change', function (e) { state.category = e.target.value; state.page = 1; loadCatalog(); });
      document.getElementById('qPrev').addEventListener('click', function () { if (state.page > 1) { state.page--; loadCatalog(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
      document.getElementById('qNext').addEventListener('click', function () { state.page++; loadCatalog(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

      // ─── Cart drawer wiring ───
      function renderCart() {
        var cart = EP.cart.read();
        var body = document.getElementById('cartBody');
        var foot = document.getElementById('cartFoot');
        var label = document.getElementById('cartCountLabel');
        var n = cart.items.length;
        label.textContent = n + (n === 1 ? ' SKU' : ' SKUs');

        if (!n) {
          body.innerHTML = '<div class="cart-empty">'
            + '<div class="cart-empty-mark">Cart Empty</div>'
            + '<h4>No items in your quotation cart</h4>'
            + '<p>Browse the catalogue and add products to build a quotation request.</p>'
            + '</div>';
          foot.style.display = 'none';
          return;
        }

        body.innerHTML = cart.items.map(function (it) {
          var img = it.image_url
            ? '<img src="' + EP.escapeHTML(it.image_url) + '" alt="">'
            : '<div class="ph">' + EP.escapeHTML((it.product_name || '').slice(0, 14)) + '</div>';
          var hasDisc = parseFloat(it.discount_pct) > 0;
          var lineTotal = parseFloat(it.effective_rate || 0) * (parseInt(it.quantity, 10) || 0);
          return '<div class="cart-item">'
            + '<div class="cart-item-img">' + img + '</div>'
            + '<div class="cart-item-meta">'
            +   (it.brand ? '<div class="brand">' + EP.escapeHTML(it.brand) + '</div>' : '')
            +   '<div class="name">' + EP.escapeHTML(it.product_name) + '</div>'
            +   '<div class="size">' + EP.escapeHTML(it.size_label || it.zoho_item_name || '') + (it.color_name ? ' · ' + EP.escapeHTML(it.color_name) : '') + '</div>'
            +   '<div class="price-row">'
            +     '<span class="now">' + EP.fmtINR(it.effective_rate) + ' / unit</span>'
            +     (hasDisc ? '<span class="was">' + EP.fmtINR(it.list_rate) + '</span>' : '')
            +     (hasDisc ? '<span class="disc">' + it.discount_pct + '% off</span>' : '')
            +   '</div>'
            +   '<div style="margin-top:10px;">'
            +     '<div class="cat-qty-stepper">'
            +       '<button type="button" data-cart-step="-1" data-pid="' + it.pack_size_id + '">−</button>'
            +       '<input type="number" min="1" max="9999" value="' + it.quantity + '" data-cart-qty data-pid="' + it.pack_size_id + '">'
            +       '<button type="button" data-cart-step="+1" data-pid="' + it.pack_size_id + '">+</button>'
            +     '</div>'
            +   '</div>'
            + '</div>'
            + '<div class="cart-item-right">'
            +   '<div class="line-total">' + EP.fmtINR(lineTotal) + '</div>'
            +   '<button type="button" class="remove" data-cart-remove="' + it.pack_size_id + '">Remove</button>'
            + '</div>'
            + '</div>';
        }).join('');

        // Wire stepper + remove
        body.querySelectorAll('[data-cart-step]').forEach(function (b) {
          b.addEventListener('click', function () {
            var pid = parseInt(b.dataset.pid, 10);
            var step = parseInt(b.dataset.step, 10);
            var cart = EP.cart.read();
            var found = cart.items.find(function (it) { return it.pack_size_id === pid; });
            if (!found) return;
            var next = (parseInt(found.quantity, 10) || 1) + step;
            EP.cart.setQty(pid, next);
            renderCart();
          });
        });
        body.querySelectorAll('[data-cart-qty]').forEach(function (inp) {
          inp.addEventListener('change', function () {
            var pid = parseInt(inp.dataset.pid, 10);
            var q = parseInt(inp.value, 10);
            EP.cart.setQty(pid, q);
            renderCart();
          });
        });
        body.querySelectorAll('[data-cart-remove]').forEach(function (rm) {
          rm.addEventListener('click', function () {
            var pid = parseInt(rm.dataset.cartRemove, 10);
            EP.cart.remove(pid);
            renderCart();
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
        document.getElementById('cartSubList').textContent = EP.fmtINR(subList);
        document.getElementById('cartSubNet').textContent = EP.fmtINR(subNet);
        if (savings > 0) {
          document.getElementById('cartSavingsRow').style.display = '';
          document.getElementById('cartSavings').textContent = '–' + EP.fmtINR(savings);
        } else {
          document.getElementById('cartSavingsRow').style.display = 'none';
        }
        foot.style.display = '';
      }

      function openCart() {
        renderCart();
        document.getElementById('cartDrawer').classList.add('is-open');
        document.getElementById('cartOverlay').classList.add('is-open');
      }
      function closeCart() {
        document.getElementById('cartDrawer').classList.remove('is-open');
        document.getElementById('cartOverlay').classList.remove('is-open');
      }

      document.getElementById('openCartBtn').addEventListener('click', openCart);
      document.getElementById('closeCartBtn').addEventListener('click', closeCart);
      document.getElementById('cartOverlay').addEventListener('click', closeCart);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          if (document.getElementById('dModal').classList.contains('is-open')) {
            document.getElementById('dModal').classList.remove('is-open');
          } else if (document.getElementById('cartDrawer').classList.contains('is-open')) {
            closeCart();
          }
        }
      });
      document.addEventListener('ep:cart-changed', renderCart);

      document.getElementById('cartClearBtn').addEventListener('click', function () {
        if (!confirm('Remove all items from the cart?')) return;
        EP.cart.clear();
        renderCart();
        EP.toast('Cart cleared.');
      });

      document.getElementById('cartSubmitBtn').addEventListener('click', async function () {
        var btn = this;
        var project = document.getElementById('cartProject').value.trim();
        var location = document.getElementById('cartLocation').value.trim();
        var notes = document.getElementById('cartNotes').value.trim();
        if (!project) { EP.toast('Project name is required.', 'err'); document.getElementById('cartProject').focus(); return; }
        if (!location) { EP.toast('Site / delivery address is required.', 'err'); document.getElementById('cartLocation').focus(); return; }
        btn.disabled = true; btn.textContent = 'Submitting…';
        try {
          var data = await EP.cart.submit({ project_name: project, location: location, additional_notes: notes });
          if (!data) return;
          EP.toast('Order submitted: ' + (data.request_number || 'OK'), 'ok');
          closeCart();
          document.getElementById('cartProject').value = '';
          document.getElementById('cartLocation').value = '';
          document.getElementById('cartNotes').value = '';
          renderCart();
          setTimeout(function () { window.location.href = '/engineer-dashboard.html#requisitions'; }, 600);
        } catch (err) {
          EP.toast(err.message || 'Submission failed.', 'err');
        } finally {
          btn.disabled = false; btn.textContent = 'Submit Order Request';
        }
      });

      document.addEventListener('DOMContentLoaded', async function () {
        var me = await EP.loadMe();
        var status = (me && me.status) || localStorage.getItem('engineer_status') || 'pending';
        if (status === 'approved') {
          loadFilters();
          loadCatalog();
        } else {
          // Pending/suspended/rejected: never request the approved-only catalogue/pricing.
          var toolbar = document.querySelector('.cat-toolbar');
          if (toolbar) toolbar.style.display = 'none';
          var pager = document.getElementById('qPager');
          if (pager) pager.style.display = 'none';
          var meta = document.getElementById('qMeta');
          if (meta) meta.textContent = '';
          document.getElementById('qGrid').innerHTML =
            '<div style="grid-column:1/-1;"><div class="ep-notice warn" style="margin:0;">'
            + '<strong>Catalogue access is pending approval.</strong> Engineer prices unlock once your account is approved by our team (typically within 24 hours). '
            + 'You can still submit a <a href="/engineer-new-quote.html" style="color:var(--ep-active);font-weight:600;">custom quotation request</a> in the meantime.'
            + '</div></div>';
        }
        renderCart();
      });

      // Delegated click handler for runtime-injected catalogue cards
      // (replaces the former inline openDetail call on the card).
      document.addEventListener('click', function (ev) {
        var t = ev.target instanceof Element ? ev.target.closest('[data-action]') : null;
        if (!t) return;
        var action = t.getAttribute('data-action');
        if (action === 'open-detail') {
          var id = parseInt(t.getAttribute('data-product-id'), 10);
          if (Number.isFinite(id)) window.openDetail(id);
        }
      });    })();
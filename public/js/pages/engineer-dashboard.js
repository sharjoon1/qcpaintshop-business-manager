(function () {
  var allProjects = [];
  var currentFilter = '';

  function hydrateHead(e) {
    var name = e ? e.full_name : (localStorage.getItem('engineer_name') || '—');
    var company = e ? e.company_name : (localStorage.getItem('engineer_company') || '');
    var id = e ? e.id : (localStorage.getItem('engineer_id') || '');
    var status = e ? e.status : (localStorage.getItem('engineer_status') || 'pending');
    var reason = e ? e.rejected_reason : null;

    document.getElementById('ephName').textContent = name;
    if (company) {
      document.getElementById('ephSep1').style.display = '';
      var c = document.getElementById('ephCompany');
      c.style.display = '';
      c.textContent = company;
    }
    document.getElementById('ephAcctId').textContent = id ? ('#ENG-' + String(id).padStart(4, '0')) : '#—';
    var st = document.getElementById('ephStatus');
    st.className = 'ep-badge s-' + status;
    st.textContent = EP.statusLabel(status);

    if (e && e.created_at) document.getElementById('acctSince').textContent = EP.fmtDate(e.created_at);
    if (e && e.credit_enabled && parseFloat(e.credit_limit) > 0) {
      document.getElementById('acctCredit').classList.remove('muted');
      document.getElementById('acctCredit').textContent = EP.fmtINR(e.credit_limit);
    }

    // Status banner
    var bar = document.getElementById('epStatusBanner');
    if (status === 'pending') {
      bar.className = 'banner-pending';
      bar.innerHTML = '⏳ Your account is pending approval. Our team will review within 24 hours.';
      bar.style.display = '';
    } else if (status === 'rejected') {
      bar.className = 'banner-rejected';
      bar.innerHTML = '<strong>Account application declined.</strong> ' + (reason ? 'Reason on record: ' + EP.escapeHTML(reason) + '. ' : '') + 'Please contact the relationship manager.';
      bar.style.display = '';
    } else if (status === 'suspended') {
      bar.style.display = '';
      bar.className = 'ep-notice err';
      bar.innerHTML = '<strong>Account suspended.</strong> Contact the relationship manager to reinstate.';
    }
  }

  function renderProjects() {
    var rows = allProjects;
    if (currentFilter === 'active') {
      rows = rows.filter(function (p) { return !['completed','rejected'].includes(p.status); });
    } else if (currentFilter === 'closed') {
      rows = rows.filter(function (p) { return ['completed','rejected'].includes(p.status); });
    }
    var tbody = document.getElementById('projBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="ep-empty"><div class="ep-empty-mark">No Records</div><h3>No requisitions on record</h3><p>Submit a project quotation request to begin tracking.</p><a href="/engineer-new-quote.html" class="ep-btn primary">Submit Quotation Request</a></div></td></tr>';
      // Update badge
      var b = document.getElementById('epBadgeRequisitions');
      if (b) b.style.display = 'none';
      return;
    }
    tbody.innerHTML = rows.slice(0, 6).map(function (p) {
      var status = p.status || 'new';
      var ref = EP.escapeHTML(p.request_number || ('#' + p.id));
      var proj = EP.escapeHTML(EP.projectTypeLabel(p.project_type));
      var loc = EP.escapeHTML(p.location || p.city || 'Site location');
      var area = p.area_sqft ? Number(p.area_sqft).toLocaleString('en-IN') + ' <small>sq ft</small>' : '—';
      return '<tr class="clickable" data-action="open-project" data-ref="' + ref + '">'
        + '<td class="mono"><b>' + ref + '</b></td>'
        + '<td><b>' + proj + '</b><br><small>' + loc + '</small></td>'
        + '<td class="num">' + area + '</td>'
        + '<td><span class="ep-badge s-' + status + '"><span class="dot"></span>' + EP.statusLabel(status) + '</span></td>'
        + '<td class="num"><small>' + EP.fmtTimeAgo(p.created_at) + '</small></td>'
        + '</tr>';
    }).join('');
  }

  async function loadProjects() {
    try {
      var r = await fetch(EP.API_BASE + '/me/projects?limit=100', { headers: EP.authHeaders() });
      if (EP.handleAuthFail(r)) return;
      var json = await r.json();
      if (!json.success) throw new Error(json.message || 'Failed');
      allProjects = json.data || [];
      var open = allProjects.filter(function (x) { return x.status === 'new' || x.status === 'contacted'; }).length;
      var quoted = allProjects.filter(function (x) { return x.status === 'quote_sent'; }).length;
      var accepted = allProjects.filter(function (x) { return x.status === 'accepted'; }).length;
      var completed = allProjects.filter(function (x) { return x.status === 'completed'; }).length;
      document.getElementById('kpiOpen').textContent = open;
      document.getElementById('kpiQuotes').textContent = quoted;
      document.getElementById('kpiAccepted').textContent = accepted;
      document.getElementById('kpiCompleted').textContent = completed;

      // Sidebar badge
      var activeCount = open + quoted + accepted;
      var b = document.getElementById('epBadgeRequisitions');
      if (b) {
        if (activeCount > 0) { b.style.display = ''; b.textContent = activeCount; }
        else b.style.display = 'none';
      }
      renderProjects();
    } catch (err) {
      console.error('[ep-dash] loadProjects', err);
      document.getElementById('projBody').innerHTML = '<tr><td colspan="5"><div class="ep-empty"><p>Unable to load requisitions. Please refresh.</p></div></td></tr>';
    }
  }

  // Delegated click handler for runtime-injected project rows
  // (replaces the former onclick="window.location='...#ref'" inline handler).
  document.addEventListener('click', function (ev) {
    var t = ev.target instanceof Element ? ev.target.closest('[data-action]') : null;
    if (!t) return;
    var action = t.getAttribute('data-action');
    if (action === 'open-project') {
      var ref = t.getAttribute('data-ref');
      window.location = '/engineer-dashboard.html#' + ref;
    }
  });

  document.addEventListener('DOMContentLoaded', async function () {
    // Filter pills
    document.querySelectorAll('.ep-pill[data-filter]').forEach(function (p) {
      p.addEventListener('click', function () {
        document.querySelectorAll('.ep-pill[data-filter]').forEach(function (q) { q.classList.remove('active'); });
        p.classList.add('active');
        currentFilter = p.getAttribute('data-filter');
        renderProjects();
      });
    });

    hydrateHead(null);
    var me = await EP.loadMe();
    if (me) hydrateHead(me);
    var status = (me && me.status) || localStorage.getItem('engineer_status') || 'pending';
    if (status === 'approved') {
      loadProjects();
    } else {
      // Pending/suspended/rejected: do NOT call the approved-only /me/projects (it 403s).
      // The status banner from hydrateHead already explains why; show a clear locked state.
      ['kpiOpen', 'kpiQuotes', 'kpiAccepted', 'kpiCompleted'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.textContent = '—';
      });
      document.getElementById('projBody').innerHTML =
        '<tr><td colspan="5"><div class="ep-empty">'
        + '<h3>Requisitions unlock once your account is approved</h3>'
        + '<p>Your application is under review. You will be able to submit and track project requisitions here after approval.</p>'
        + '</div></td></tr>';
    }
  });
})();

/*
 * tourController.js — unified driver.js front-end for the horilla_tour engine.
 *
 * Loaded globally on every authenticated page. On load it asks the backend
 * which published tours apply to the current page + user (`/tour/api/active/`),
 * auto-starts the highest-priority unfinished `auto_once` tour, and exposes a
 * "Help / Take a tour" launcher (window.horillaTour) so users can replay any
 * tour on demand. Completion / skip is reported to `/tour/api/progress/`,
 * superseding the legacy /driver-viewed mechanism.
 */
(function () {
  "use strict";

  // i18n: gettext is provided by Django's javascript-catalog; fall back to identity.
  var _t = window.gettext || function (s) { return s; };

  var ctx = window.HORILLA_TOUR || { page: "", path: "", activeUrl: "", progressUrl: "" };
  var TOURS = [];

  function getCookie(name) {
    var m = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
    return m ? m.pop() : "";
  }

  function driverFactory() {
    return window.driver && window.driver.js && window.driver.js.driver;
  }

  function postProgress(tourId, status, lastStep) {
    if (!ctx.progressUrl) return;
    var body = new URLSearchParams();
    body.append("tour_id", tourId);
    body.append("status", status);
    body.append("last_step", lastStep == null ? "" : String(lastStep));
    fetch(ctx.progressUrl, {
      method: "POST",
      headers: {
        "X-CSRFToken": getCookie("csrftoken"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      credentials: "same-origin",
      body: body.toString(),
    }).catch(function () {/* progress is best-effort */});
  }

  function buildSteps(tour) {
    return (tour.steps || []).map(function (s) {
      var step = {
        popover: {
          title: s.title || "",
          description: s.description || "",
          side: s.side && s.side !== "over" ? s.side : "bottom",
          align: s.align || "start",
        },
      };
      if (s.element) {
        step.element = s.element;
      }
      return step;
    });
  }

  function runTour(tour) {
    var driver = driverFactory();
    if (!driver) return;
    var steps = buildSteps(tour);
    if (!steps.length) return;

    var maxIndex = 0;
    var driverObj = driver({
      showProgress: !!tour.show_progress,
      allowClose: tour.allow_close !== false,
      animate: true,
      showButtons: ["next", "previous", "close"],
      nextBtnText: _t("Next"),
      prevBtnText: _t("Back"),
      doneBtnText: _t("Done"),
      progressText: _t("{{current}} of {{total}}"),
      steps: steps,
      onHighlighted: function (el, step, opts) {
        try {
          var idx = opts && opts.state ? opts.state.activeIndex : 0;
          if (typeof idx === "number" && idx > maxIndex) maxIndex = idx;
        } catch (e) {/* noop */}
      },
      onDestroyed: function () {
        var completed = maxIndex >= steps.length - 1;
        postProgress(tour.id, completed ? "completed" : "skipped", maxIndex);
        // reflect new status locally so the launcher updates without a reload
        tour.status = completed ? "completed" : "skipped";
      },
    });
    closeLauncher();
    driverObj.drive();
  }

  /* ----------------------------- Launcher UI ----------------------------- */

  function launcherEl() {
    return document.getElementById("horillaTourLauncher");
  }

  function closeLauncher() {
    var el = launcherEl();
    if (el) el.remove();
  }

  function renderLauncher() {
    closeLauncher();
    var panel = document.createElement("div");
    panel.id = "horillaTourLauncher";
    panel.setAttribute("role", "dialog");
    panel.style.cssText =
      "position:fixed;top:64px;right:24px;width:320px;max-height:70vh;overflow:auto;" +
      "background:#fff;border:1px solid #e3e3e3;border-radius:12px;z-index:100000;" +
      "box-shadow:0 12px 32px rgba(0,0,0,.18);padding:14px;font-size:14px;";

    var header =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '<strong style="font-size:15px;">' + _t("Guided tours") + "</strong>" +
      '<span id="horillaTourClose" style="cursor:pointer;font-size:18px;line-height:1;">&times;</span></div>';

    var bodyHtml;
    if (!TOURS.length) {
      bodyHtml =
        '<p style="color:#888;margin:8px 0;">' +
        _t("No tours are available for this page yet.") + "</p>";
    } else {
      bodyHtml = TOURS.map(function (t, i) {
        var done = t.status === "completed" || t.status === "skipped";
        var btn = done ? _t("Replay") : _t("Start");
        var badge = done
          ? '<span style="font-size:11px;color:#16a34a;">✓ ' + _t("Done") + "</span>"
          : "";
        return (
          '<div style="border:1px solid #eee;border-radius:8px;padding:10px;margin-bottom:8px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;">' +
          '<strong>' + escapeHtml(t.title) + "</strong>" + badge + "</div>" +
          (t.description
            ? '<p style="color:#777;margin:4px 0 8px;font-size:13px;">' +
              escapeHtml(t.description) + "</p>"
            : '<div style="height:4px"></div>') +
          '<button data-tour-index="' + i + '" class="oh-btn oh-btn--secondary-outline horilla-tour-start" ' +
          'style="padding:4px 12px;font-size:13px;">' + btn + "</button></div>"
        );
      }).join("");
    }

    panel.innerHTML = header + bodyHtml;
    document.body.appendChild(panel);

    panel.querySelector("#horillaTourClose").addEventListener("click", closeLauncher);
    panel.querySelectorAll(".horilla-tour-start").forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = parseInt(b.getAttribute("data-tour-index"), 10);
        if (TOURS[idx]) runTour(TOURS[idx]);
      });
    });

    // dismiss on outside click
    setTimeout(function () {
      document.addEventListener("click", outsideClose, true);
    }, 0);
  }

  function outsideClose(e) {
    var el = launcherEl();
    var btn = document.getElementById("tourLauncherBtn");
    if (el && !el.contains(e.target) && (!btn || !btn.contains(e.target))) {
      closeLauncher();
      document.removeEventListener("click", outsideClose, true);
    }
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : s;
    return d.innerHTML;
  }

  function toggleLauncher() {
    if (launcherEl()) {
      closeLauncher();
    } else {
      renderLauncher();
    }
  }

  /* ------------------------------- Bootstrap ------------------------------ */

  function loadAndAuto() {
    if (!ctx.activeUrl) return;
    var url =
      ctx.activeUrl +
      "?page=" + encodeURIComponent(ctx.page || "") +
      "&path=" + encodeURIComponent(ctx.path || "");
    fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then(function (r) { return r.ok ? r.json() : { tours: [] }; })
      .then(function (data) {
        TOURS = (data && data.tours) || [];
        var auto = TOURS.filter(function (t) { return t.auto_start; });
        if (auto.length) {
          // small delay so the page (and any HTMX content) has settled
          setTimeout(function () { runTour(auto[0]); }, 800);
        }
      })
      .catch(function () {/* never block the page */});
  }

  window.horillaTour = {
    toggle: toggleLauncher,
    open: renderLauncher,
    close: closeLauncher,
    run: runTour,
    reload: loadAndAuto,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAndAuto);
  } else {
    loadAndAuto();
  }
})();

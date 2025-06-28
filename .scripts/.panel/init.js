// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    await refreshBookingData();
    scheduleQuarterHourUpdates(refreshBookingData);
});
  
document.getElementById("test-trigger")?.addEventListener("click", async () => {
    await triggerLockCode("0752", "Light Loft");
});

// POPUP CLOSE & OPEN
document.getElementById("popup-closer")?.addEventListener("click", () => {
  closePopup();
  setTimeout(() => {
    document.getElementById("popup")?.classList.remove("entry");
  }, 300);
});
document.getElementById("popup-close-btn").addEventListener("click", closePopup);
document.getElementById("popup-confirm-closer").addEventListener("click", closePopup);
  
// AMENITIES ACCORDION
document.addEventListener("DOMContentLoaded", () => {
    // Remove .open from all amenities on page load
    document.querySelectorAll(".amenity").forEach(el => {
      el.classList.remove("open");
      const icon = el.querySelector(".cross-icon");
      if (icon) icon.classList.remove("open");
    });
  
    // Add click listener to each .amenity_title
    document.querySelectorAll(".amenity_title").forEach(title => {
      title.addEventListener("click", () => {
        const amenity = title.closest(".amenity");
        const isOpen = amenity.classList.contains("open");
  
        // Remove .open from all amenities and icons
        document.querySelectorAll(".amenity").forEach(el => {
          el.classList.remove("open");
          const icon = el.querySelector(".cross-icon");
          if (icon) icon.classList.remove("open");
        });
  
        // If it was not already open, open it
        if (!isOpen) {
          amenity.classList.add("open");
          const icon = title.querySelector(".cross-icon");
          if (icon) icon.classList.add("open");
        }
      });
    });
});

// ADD TIME
document.getElementById("actions_add-time")?.addEventListener("click", async () => {
  const details = window.currentBooking;
  if (!details) return alert("No booking loaded.");

  const originalEnd = luxon.DateTime.fromISO(details.end, { zone: TIMEZONE });
  const interval = 30; // or fetch from listing config

  addTimeExtension = {
    originalStart: luxon.DateTime.fromISO(details.start, { zone: TIMEZONE }),
    originalEnd,
    current: { end: originalEnd },
    interval
  };

  document.getElementById("add-time-limit").textContent = `Add up to 2 hours after`; // Or calculate
  updateAddTimeUI();

  showPopupById("add-time-popup");
});

document.getElementById("end-more-btn")?.addEventListener("click", () => {
  const { current, originalEnd, interval } = addTimeExtension;
  const newEnd = current.end.plus({ minutes: interval });
  if (newEnd <= originalEnd.plus({ minutes: 120 })) {
    current.end = newEnd;
    updateAddTimeUI();
  }
});

document.getElementById("end-less-btn")?.addEventListener("click", () => {
  const { current, originalEnd, interval } = addTimeExtension;
  const newEnd = current.end.minus({ minutes: interval });
  if (newEnd >= originalEnd) {
    current.end = newEnd;
    updateAddTimeUI();
  }
});

document.getElementById("confirm-add-time")?.addEventListener("click", async () => {
  const details = window.currentBooking;
  const { originalEnd, current } = addTimeExtension;
  const addedMinutes = current.end.diff(originalEnd, "minutes").minutes;

  if (addedMinutes <= 0) return;

  const subtotal = (details.transaction.final_rate / 60) * addedMinutes;
  const taxRate = details.transaction.tax_rate || 0.0825;
  const taxTotal = subtotal * taxRate;
  const total = subtotal + taxTotal;

  const lineItem = `Added ${Math.round(addedMinutes)} Minutes`;

  await addChargeHandler({
    lineItem,
    subtotal,
    taxTotal,
    total,
    onSuccess: async () => {
      const payload = {
        booking_id: details.uuid,
        start: details.start,
        end: current.end.toISO(),
        duration: current.end.diff(luxon.DateTime.fromISO(details.start), "minutes").minutes,
        listing_name: details.listing?.name || "",
        added_minutes: addedMinutes
      };

      await fetch("https://hook.us1.make.com/zse7u92reikd8k266hhalkgvjawp9jk2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      showPopupById("confirmation-popup");
      document.getElementById("confirm-popup-header").textContent = "Time Added";
      document.getElementById("confirm-popup-paragraph").textContent = "Your booking has been extended.";
    }
  });
});

// CHECKOUT PROCESS
window.initCheckoutScrollFlow = async function () {
  console.log("🚀 Initializing dynamic scroll-based checkout...");

  const allSteps = await loadCheckoutProcess(LISTING_UUID);
  let successStep = null;
  const steps = [];

  for (const step of allSteps) {
    if (step.type === "success") {
      successStep = step;
    } else {
      steps.push(step);
    }
  }

  const container = document.getElementById("checkout-process");
  container.innerHTML = ""; // clear existing content

  if (!steps?.length) {
    container.innerHTML = "<p>No checkout steps found.</p>";
    return;
  }

  const responses = {};
  const elements = {}; // keep refs for data gathering

  steps.forEach((step, index) => {
    const stepId = `${step.title?.toLowerCase().replace(/\s+/g, "-")}-${step.type}`;

    const wrapper = document.createElement("div");
    wrapper.classList.add("section-container");

    const headerBlock = document.createElement("div");
    headerBlock.classList.add("div-block-249");

    const stepNumber = document.createElement("div");
    stepNumber.classList.add("text-block-108");
    stepNumber.textContent = `${index + 1}`;

    const header = document.createElement("div");
    header.classList.add("section-header");
    header.textContent = step.title || "";

    headerBlock.append(stepNumber, header);

    const content = document.createElement("div");
    content.classList.add("checkout-step-content");

    const description = document.createElement("div");
    description.classList.add("checkout-description");
    description.textContent = step.description || "";

    content.appendChild(description);

    // === Step Type Handling ===
    if (step.type === "gallery") {
      const gallery = document.createElement("div");
      gallery.classList.add("checkout-gallery");
      let imgIndex = 0;

      gallery.style.backgroundImage = `url(${step.gallery[imgIndex]})`;

      const prev = document.createElement("a");
      prev.href = "#";
      prev.textContent = "←";
      prev.onclick = e => {
        e.preventDefault();
        imgIndex = (imgIndex - 1 + step.gallery.length) % step.gallery.length;
        gallery.style.backgroundImage = `url(${step.gallery[imgIndex]})`;
      };

      const next = document.createElement("a");
      next.href = "#";
      next.textContent = "→";
      next.onclick = e => {
        e.preventDefault();
        imgIndex = (imgIndex + 1) % step.gallery.length;
        gallery.style.backgroundImage = `url(${step.gallery[imgIndex]})`;
      };

      gallery.append(prev, next);
      content.appendChild(gallery);
    }

    if (step.type === "checkbox" || step.type === "show-field") {
      const fieldContainer = document.createElement("div");
      fieldContainer.classList.add("section-container", "form-fields");

      const label = document.createElement("label");
      label.classList.add("checkbox-field", "light");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.classList.add("checkbox");
      checkbox.name = stepId;
      checkbox.id = stepId;
      checkbox.checked = step["show-field"]?.["checkbox-default"] || step["default"] || false;

      const checkmark = document.createElement("div");
      checkmark.classList.add("checkmark");

      const checkboxTextSection = document.createElement("div");
      checkboxTextSection.classList.add("checkbox-text-section");

      const checkboxText = document.createElement("p");
      checkboxText.classList.add("checkbox-text");
      checkboxText.textContent = step["show-field"]?.["checkbox-label"] || step["checkbox-label"] || "Checkbox";

      checkboxTextSection.appendChild(checkboxText);
      label.append(checkbox, checkmark, checkboxTextSection);
      fieldContainer.appendChild(label);

      const updateCheckboxVisual = () => {
        label.classList.toggle("checked", checkbox.checked);
        checkmark.classList.toggle("checked", checkbox.checked);
      };

      checkbox.addEventListener("change", updateCheckboxVisual);
      updateCheckboxVisual();

      // Textarea for show-field
      let textarea;
      if (step.type === "show-field") {
        const inputWrapper = document.createElement("div");
        inputWrapper.classList.add("form-input");

        const inputLabel = document.createElement("div");
        inputLabel.classList.add("field-label");
        inputLabel.textContent = step["show-field"]["field-label"] || "Message";

        textarea = document.createElement("textarea");
        textarea.classList.add("input-field", "textarea");
        textarea.name = `${stepId}-textarea`;
        textarea.id = `${stepId}-textarea`;

        inputWrapper.append(inputLabel, textarea);
        fieldContainer.appendChild(inputWrapper);

        checkbox.checked = step["show-field"]?.["checkbox-default"] || false;

        const toggleTextarea = () => {
          const shouldHide = checkbox.checked === step["show-field"]["show-field-if"];
          inputWrapper.classList.toggle("hidden", shouldHide);
        };        

        checkbox.addEventListener("change", toggleTextarea);
        toggleTextarea();
      }

      content.appendChild(fieldContainer);
      elements[stepId] = { checkbox, textarea };
    }

    wrapper.append(headerBlock, content);
    container.appendChild(wrapper);
  });

  // === Submit Button ===
  const submitBtn = document.createElement("a");
  submitBtn.href = "#";
  submitBtn.id = "checkout-submit";
  submitBtn.classList.add("button", "w-inline-block");

  submitBtn.innerHTML = `
    <div class="button-text-wrapper">
      <div class="button-text-container">
        <div class="button-text">Complete Checkout Process</div>
        <div class="button-text-with-icon">
          <div class="button-text">Complete Checkout Process</div>
          <div class="button-icon">→</div>
        </div>
      </div>
    </div>
  `;

  submitBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    const payload = {
      booking_id: bookingUuid,
      responses: {}
    };

    Object.entries(elements).forEach(([key, el]) => {
      if (el.checkbox && el.textarea) {
        const show = el.checkbox.checked !== steps.find(s =>
          key.startsWith(s.title?.toLowerCase().replace(/\s+/g, "-"))
        )["show-field"]["show-field-if"];
    
        const value = el.textarea.value.trim();
        if (show && value !== "") {
          payload.responses[key] = {
            checked: el.checkbox.checked,
            value
          };
        } else if (el.checkbox.checked) {
          payload.responses[key] = {
            checked: true,
            value: null
          };
        }
        // Else skip entirely
      } else if (el.checkbox) {
        payload.responses[key] = el.checkbox.checked;
      }
    });    

    console.log("📤 Submitting dynamic checkout:", payload);

    try {
      await fetch("https://hook.us1.make.com/lila320113a7nngn29ix7yl94snyqjjr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      console.log("✅ Submission complete");
      if (successStep) {
        details = await rebuildBookingDetails(bookingUuid);
        populateReservationDetails(details);
        applyActionButtonStates(details);
        
        document.getElementById("confirm-popup-header").textContent = successStep.title || "Thank You";
        document.getElementById("confirm-popup-paragraph").textContent = successStep.description || "Your checkout is complete.";
        showPopupById("confirmation-popup");
      }
    } catch (err) {
      console.error("❌ Submission failed:", err);
      alert("Checkout submission failed. Please try again.");
    }
  });

  container.appendChild(submitBtn);
};

document.getElementById("actions_checkout")?.addEventListener("click", async () => {
  await initCheckoutScrollFlow();
  showPopupById("checkout-process");
});


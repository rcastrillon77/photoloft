const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");
let details = null;

const { DateTime } = luxon;
const timezone = details?.listing?.timezone || 'America/Chicago';
const CANCELLATION_WEBHOOK_URL = "https://hook.us1.make.com/vl0m26yyj1pc4hzll2aplox16qmorajg";

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}

async function rebuildBookingDetails(bookingUuid) {
  const { data: bookingData, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("uuid", bookingUuid)
    .maybeSingle();

  if (error || !bookingData) {
    console.error("❌ Booking not found or error:", error);
    return null;
  }

  const [user, transaction, events, locations] = await Promise.all([
    supabase.from("users").select("*").eq("uuid", bookingData.user_id).maybeSingle(),
    supabase.from("transactions").select("*").eq("uuid", bookingData.transaction_id).maybeSingle(),
    supabase.from("events").select("*").in("uuid", bookingData.event_id).then(res => res.data || []),
    supabase.from("locations").select("*").in("uuid", bookingData.location_id).then(res => res.data || [])
  ]);

  details = {
    start: bookingData.details.start || null,
    end: bookingData.details.end || null,
    status: bookingData.status || null,
    duration: bookingData.details.duration || null,
    attendees: bookingData.details?.attendees || null,
    activities: bookingData.details?.activities || [],
    user: {
      first_name: bookingData.details.user?.first_name || "",
      last_name: bookingData.details.user?.last_name || "",
      email: bookingData.details.user?.email || "",
      phone: bookingData.details.user?.phone || "",
      membership: bookingData.details.user?.membership || "guest"
    },
    listing: bookingData.details?.listing || {
      name: bookingData.details.listing?.name || "",
      address_line_1: bookingData.details.listing?.address_line_1 || "",
      address_line_2: bookingData.details.listing?.address_line_2 || "",
      city: bookingData.details.listing?.city || "",
      state: bookingData.details.listing?.state || "",
      zip_code: bookingData.details.listing?.zip_code || "",
      timezone: bookingData.details.listing?.timezone || "America/Chicago",
      coordinates: bookingData.details.listing?.coordinates || {}
    },
    activities: bookingData.details?.activities || [],
    transaction: {
      subtotal: bookingData.details.transaction?.subtotal || 0,
      total: bookingData.details.transaction?.total || 0,
      tax_rate: bookingData.details.transaction?.tax_rate || 0,
      tax_total: bookingData.details.transaction?.tax_total || 0,
      discount_total: bookingData.details.transaction?.discount_total || 0,
      base_rate: bookingData.details.transaction?.base_rate || 0,
      final_rate: bookingData.details.transaction?.final_rate || 0,
      rate_label: bookingData.details.transaction?.rate_label || "",
      user_credits_applied: bookingData.details.transaction?.user_credits_applied || 0,
      discounts: bookingData.details.transaction?.discounts || []
    }
  };

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
    return null;
  }

  console.log("✅ Booking details updated.");
  return details;
}

function populateReservationDetails(details) {
  if (!details) return;

  const start = DateTime.fromISO(details.start).setZone(timezone);
  const end = DateTime.fromISO(details.end).setZone(timezone);

  document.getElementById("details_user").textContent =
    `${details.user?.first_name || ''} ${details.user?.last_name || ''}`;

  document.getElementById("details_status").textContent = `${details?.status?.charAt(0).toUpperCase() + details?.status?.slice(1) || ''} Booking`;

  document.getElementById("details_listing").textContent =
    details.listing?.name || "";

  document.getElementById("details_address-1").innerHTML = `
    ${details.listing?.address_line_1 || ''} ${details.listing?.address_line_2 || ''}
  `;

  document.getElementById("details_address-2").innerHTML = `
  ${details.listing?.city || ''}, ${details.listing?.state || ''} ${details.listing?.zip_code || ''}
  `;

  document.getElementById("details_date").textContent =
    DateTime.fromISO(start).setZone(timezone).toFormat('cccc, LLLL d, yyyy');

  document.getElementById("details_start").textContent = start.toFormat("h:mm a");
  document.getElementById("details_end").textContent =  end.toFormat("h:mm a ZZZZ")

  document.getElementById("details_duration").textContent =
    `${details.duration || '?'} Hours`;

  document.getElementById("details_attendees").textContent =
    `${details.attendees || '?'} People`;

  document.getElementById("details_paid").textContent =
    `$${(details.transaction?.total || 0).toFixed(2)}`;
}

function openPopup() {
  document.getElementById("popup-container").classList.remove("hide");
  document.body.classList.add("no-scroll");
}

function closePopup() {
  document.getElementById("popup-container").classList.add("hide");
  document.body.classList.remove("no-scroll");
  document.querySelectorAll(".popup-content").forEach(el => el.classList.add("hidden"));
}

function showPopupById(id) {
  document.querySelectorAll(".popup-content").forEach(el => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  openPopup();
}

function getRefundAmounts(startISO, totalPaid, userCreditsUsed, taxTotal) {
  const now = luxon.DateTime.now();
  const start = luxon.DateTime.fromISO(startISO).setZone(timezone);
  const diffInHours = start.diff(now, "hours").hours;
  const diffInDays = Math.floor(diffInHours / 24);

  let creditPercent = 0;
  let message = "";
  let confirmMessage = "";
  let onlyCredit = true;

  if (diffInHours >= 168) {
    creditPercent = 1;
    message = "Since your booking is more than 7 days away, you are eligible for a 100% credit to your account.";
  } else if (diffInHours >= 24) {
    creditPercent = 0.5;
    message = `Since your booking is in ${diffInDays} days, you are eligible for a 50% credit to your account.`;
  } else {
    creditPercent = 0;
    message = "Since your booking is within 24 hours, you are not eligible for a credit.";
  }

  const creditAmount = totalPaid * creditPercent;
  const taxRefund = taxTotal * creditPercent;
  const reissuedCredits = userCreditsUsed * creditPercent;

  if (creditPercent === 0) {
    confirmMessage = "Your booking has been successfully cancelled. We hope to see you in one of our studios in the near future.";
  } else if (creditAmount === 0 && reissuedCredits === 0) {
    confirmMessage = "Your booking has been successfully cancelled. Since this booking has no payment, no credit will be issued. We hope to see you in one of our studios in the near future.";
  } else {
    const totalCredit = creditAmount + reissuedCredits;
    confirmMessage = `Your booking has been successfully cancelled. You will receive a $${totalCredit.toFixed(2)} credit back to your account, available to use immediately. We hope to see you in one of our studios in the near future.`;
  }

  return {
    credit_refund: creditAmount.toFixed(2),
    taxRefund: taxRefund.toFixed(2),
    credits_reissued: reissuedCredits.toFixed(2),
    message,
    confirmMessage,
    onlyCredit
  };
}

async function processCancellation(refundData) {
  try {
    const payload = {
      booking_uuid: bookingUuid,
      listing_name: details.listing?.name || "",
      credit_refund: parseFloat(refundData.credit_refund),
      credit_reissue: parseFloat(refundData.credits_reissued),
      cash_refund: 0,
      tax_total: parseFloat(refundData.taxRefund)
    };

    const response = await fetch(CANCELLATION_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Webhook failed");

    await rebuildBookingDetails(bookingUuid);

    const popup = document.getElementById("confirm-popup");
    popup.querySelector(".popup-header").textContent = "Booking Cancelled";
    popup.querySelector(".popup-text").textContent = refundData.confirmMessage;

    showPopupById("confirm-popup");
  } catch (err) {
    alert("There was a problem cancelling your booking. Please try again.");
  }
}


async function initReservationUpdate() {
  if (!bookingUuid) return;

  details = await rebuildBookingDetails(bookingUuid);
  if (!details) {
    alert("Unable to load booking.");
    return;
  }

  populateReservationDetails(details);
  console.log("✅ Reservation populated.");
}

initReservationUpdate();

// POPUP CLOSE & OPEN
document.getElementById("popup-closer").addEventListener("click", closePopup);
document.getElementById("popup-close-btn").addEventListener("click", closePopup);

document.getElementById("actions_cancel").addEventListener("click", () => {
  const refund = getRefundAmounts(
    details.start,
    details.transaction.total,
    details.transaction.user_credits_applied,
    details.transaction.tax_total
  );
  
  // Already sets up paragraph and button text etc.
  document.getElementById("cancel-paragraph").innerText = refund.message;
  
  document.getElementById("confirm-credit-cancel").onclick = () => {
    processCancellation(refund);
  };

});

document.getElementById("actions_reschedule").addEventListener("click", () => {
  showPopupById("reschedule-popup");
});

document.getElementById("cancel-contact-trigger").addEventListener("click", () => {
  showPopupById("support-popup");
});


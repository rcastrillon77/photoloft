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
  const start = luxon.DateTime.fromISO(startISO).setZone("America/Chicago");
  const diff = start.diff(now, "days").days;
  const roundedDiff = Math.floor(diff);

  let cashPercent = 0;
  let creditPercent = 0;
  let message = "";
  let onlyCredit = false;

  if (diff >= 10) {
    cashPercent = 1;
    creditPercent = 1;
    message = `Since your booking is over 10 days away, you are eligible for a 100% credit to your account or a full refund to your original payment method.`;
  } else if (diff >= 5) {
    cashPercent = 0.5;
    creditPercent = 0.6;
    message = `Since your booking is in ${roundedDiff} days, you are eligible for a 50% refund or 60% credit to your account.`;
  } else if (diff >= 2) {
    cashPercent = 0.25;
    creditPercent = 0.35;
    message = `Since your booking is in ${roundedDiff} days, you are eligible for a 25% refund or 35% credit to your account.`;
  } else {
    cashPercent = 0;
    creditPercent = 0.1;
    message = `Since your booking is today, you are not eligible for a refund. We will issue a 10% credit to your account available to use immediately.`;
    onlyCredit = true;
  }

  const user_credits_returned = userCreditsUsed * cashPercent;
  const cash_refund = Math.max(0, (totalPaid - userCreditsUsed) * cashPercent).toFixed(2);
  const credit_refund = Math.max(0, (totalPaid - userCreditsUsed) * creditPercent).toFixed(2);
  const taxRefund = parseFloat((taxTotal * (onlyCredit ? creditPercent : cashPercent)).toFixed(2));
  const credits_reissued = Math.max(0, user_credits_returned).toFixed(2);

  return {
    cash_refund,
    credit_refund,
    credits_reissued,
    message,
    onlyCredit,
    taxRefund
  };
}

async function sendCancellationWebhook(type, refundData) {
  const payload = {
    booking_uuid: bookingUuid,
    listing_name: details.listing?.name || "",
    cash_refund: type === "cash" ? parseFloat(refundData.cash_refund) : 0,
    credit_refund: type === "credit" ? parseFloat(refundData.credit_refund) : parseFloat(refundData.credits_reissued),
    credit_reissue: parseFloat(refundData.credits_reissued),
    tax_total: parseFloat(refundData.taxRefund)
  };

  const res = await fetch(CANCELLATION_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return res.ok;
}

async function processCancellation(type = "credit", refundData) {
  const isCredit = type === "credit";
  const amount = isCredit ? refundData.credit : refundData.cash;

  try {
    await sendCancellationWebhook({
      booking_uuid: details.uuid,
      listing_name: details.listing.name,
      credit_refund: isCredit ? amount : 0,
      cash_refund: isCredit ? 0 : amount,
      user_credits_returned: refundData.user_credits_returned
    });

    rebuildBookingDetails();

    let message = "";

    if (refundData.cash === 0 && refundData.credit > 0) {
      message = `You’ve received a $${refundData.credit.toFixed(2)} credit, available to use immediately.`;
    } else if (isCredit) {
      message = `You will receive a $${refundData.credit.toFixed(2)} credit back to your Photoloft account, available to use immediately.`;
    } else {
      message = `You will receive a $${refundData.cash.toFixed(2)} refund to your original payment method. Refunds can take 5–10 business days to process.`;
    }

    document.getElementById("confirm-popup").querySelector(".popup-header").textContent = "Booking Cancelled";
    document.getElementById("confirm-popup").querySelector(".popup-text").textContent = `Your booking has been cancelled. ${message}`;
    showPopupById("confirm-popup");

  } catch (err) {
    alert("There was a problem cancelling your booking. Please try again.");
  }
}
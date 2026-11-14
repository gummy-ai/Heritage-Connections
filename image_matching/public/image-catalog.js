/* Optional adapter: keep the recommender and its ranking unchanged. */
export async function loadImageCatalog({
  manifestUrl = new URL("./artifact-images.json", import.meta.url),
  existingManifestUrl = null,
  existingAssetBaseUrl = null,
  fallbackUrl = new URL("./image-unavailable.svg", import.meta.url),
} = {}) {
  const absoluteManifest = new URL(manifestUrl, globalThis.location?.href || import.meta.url);
  const requests = [fetch(absoluteManifest).then(requireJSON)];
  if (existingManifestUrl) requests.push(fetch(existingManifestUrl).then(requireJSON));
  const responses = await Promise.allSettled(requests);
  const catalog = new Map();
  if (responses[0].status === "fulfilled") {
    for (const [id, entry] of Object.entries(responses[0].value.artifacts || {})) {
      if (!entry.representative_image_url || entry.license?.code !== "1") continue;
      catalog.set(id, {
        ...entry,
        imageUrl: new URL(entry.representative_image_url, absoluteManifest).href,
        sourceUrl: entry.official_detail_page_url || "",
        licenseLabel: entry.license.label || "",
      });
    }
  }
  // Keep the existing 22 images and their credits. Do not match on title or bare collection number.
  if (responses[1]?.status === "fulfilled") {
    if (!existingAssetBaseUrl) throw new Error("Existing images require an explicit asset base URL.");
    for (const entry of responses[1].value) {
      const institution = entry.institution || entry.credit;
      if (!institution || !entry.id || !entry.webPath) continue;
      const id = `artifact::${institution}::${entry.id}`;
      catalog.set(id, {
        project_id: id, institution, collection_number: entry.id, title: entry.title,
        imageUrl: new URL(entry.webPath, existingAssetBaseUrl).href,
        sourceUrl: entry.sourceUrl || "", credit: entry.credit || "", licenseLabel: entry.license || "",
      });
    }
  }
  return function imageForRecommendation(recommendation) {
    const id = recommendation.headKey || recommendation.project_id ||
      (recommendation.institution && recommendation.id
        ? `artifact::${recommendation.institution}::${recommendation.id}` : "");
    return catalog.get(id) || {
      project_id: id, title: recommendation.name || recommendation.title || "유물",
      imageUrl: String(fallbackUrl), missing: true, sourceUrl: "", credit: "", licenseLabel: "",
    };
  };
}

async function requireJSON(response) {
  if (!response.ok) throw new Error(`Image catalog HTTP ${response.status}`);
  return response.json();
}

export function createArtifactPhoto(record, { fallbackUrl = new URL("./image-unavailable.svg", import.meta.url) } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", `${record.title}: 사진과 출처 보기`);
  const image = document.createElement("img");
  image.src = record.imageUrl;
  image.alt = record.missing ? `${record.title} — 사진 미확보` : `${record.title} — ${record.credit}`;
  image.loading = "lazy";
  image.addEventListener("error", () => { image.src = String(fallbackUrl); }, { once: true });
  button.append(image);
  button.addEventListener("click", () => {
    const dialog = document.createElement("dialog");
    const title = document.createElement("h2");
    title.textContent = record.title;
    const photo = document.createElement("img");
    photo.src = image.src;
    photo.alt = image.alt;
    photo.style.maxWidth = "min(80vw, 700px)";
    photo.style.maxHeight = "65vh";
    photo.style.objectFit = "contain";
    const credit = document.createElement("p");
    credit.textContent = record.missing ? "사진을 아직 확보하지 못했습니다." : `${record.credit} · ${record.licenseLabel}`;
    const identity = document.createElement("p");
    identity.textContent = [record.institution, record.collection_number].filter(Boolean).join(" · ");
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "닫기";
    close.addEventListener("click", () => dialog.close());
    dialog.append(title, identity, photo, credit);
    if (record.sourceUrl) {
      const link = document.createElement("a");
      link.href = record.sourceUrl;
      link.textContent = "공식 소장품 상세정보";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      dialog.append(link);
    }
    if (record.license?.policy_url) {
      const policy = document.createElement("a");
      policy.href = record.license.policy_url;
      policy.textContent = "이미지 이용조건 안내";
      policy.target = "_blank";
      policy.rel = "noopener noreferrer";
      dialog.append(policy);
    }
    dialog.append(close);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
  return button;
}

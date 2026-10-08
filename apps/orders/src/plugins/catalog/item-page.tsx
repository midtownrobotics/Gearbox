import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuthUser } from "../../shared/auth";
import { formatCents, formatDate } from "../../shared/format";
import { Button, Card, ErrorBanner, Loading, Page, SuccessBanner } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { priceIsFresh } from "../requests/draft";
import type { RequestDone, RequestFrom } from "../requests/request-page";
import { invalidateCatalog, loadCatalog } from "./catalog-data";
import { ItemEditor } from "./item-editor";

const LINK_LABEL = {
  product: "Product page ↗",
  search: "Vendor search ↗",
  homepage: "Vendor site ↗",
};

const primaryLink =
  "rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700";
const secondaryLink =
  "rounded-lg border border-secondary-300 bg-surface px-4 py-2 text-sm font-semibold text-secondary-800 hover:bg-secondary-50";

/**
 * One catalog part (/catalog/items/:id): what it is, what we last paid, and buttons to request it
 * or put it on the wishlist. The catalog's search box opens it for a pasted link it knows.
 */
export function CatalogItemPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const cameFromApp = location.key !== "default";
  const here = `${location.pathname}${location.search}`;
  const done = (location.state as RequestDone | null)?.requestMessage;
  const { canEditCatalog } = useAuthUser();
  const [editing, setEditing] = useState(false);
  const { data, error, reload } = useLoad(loadCatalog, []);
  const back = (
    <button
      type="button"
      onClick={() => (cameFromApp ? navigate(-1) : navigate("/catalog"))}
      className="text-sm text-secondary-500 hover:text-secondary-800"
    >
      ← {cameFromApp ? "Back" : "New Request"}
    </button>
  );

  if (error || !data) {
    return (
      <Page title="Catalog part" actions={back}>
        {error ? <ErrorBanner message={error} /> : <Loading />}
      </Page>
    );
  }
  const item = data.byId.get(Number(id));
  if (!item) {
    return (
      <Page title="Catalog part" actions={back}>
        <ErrorBanner message="That part isn't in the catalog anymore." />
      </Page>
    );
  }
  const family = item.familyId !== null ? data.families.get(item.familyId) : undefined;
  const options = Object.entries(item.options);

  return (
    <Page title="Catalog part" actions={back}>
      {done && <SuccessBanner message={done} />}
      {editing ? (
        <ItemEditor
          item={item}
          categories={data.categories}
          onDone={(saved) => {
            setEditing(false);
            if (!saved) return;
            invalidateCatalog();
            reload();
          }}
        />
      ) : (
        <Card>
          <div className="flex flex-col gap-6 md:flex-row">
            {item.image && (
              <img
                src={item.image}
                alt=""
                className="h-48 w-full shrink-0 rounded-lg bg-secondary-50 object-contain md:w-48"
              />
            )}
            <div className="min-w-0 flex-1 space-y-3">
              <h2 className="text-xl font-semibold text-secondary-900">{item.name}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                {family && family.name !== item.name && <Row label="Family">{family.name}</Row>}
                <Row label="Category">{item.category}</Row>
                <Row label="Vendor">{item.vendor}</Row>
                {item.sku && (
                  <Row label="SKU">
                    <span className="font-mono">{item.sku}</span>
                  </Row>
                )}
                {options.map(([name, value]) => (
                  <Row key={name} label={name}>
                    {value}
                  </Row>
                ))}
                {item.packQuantity > 1 && <Row label="Pack of">{item.packQuantity}</Row>}
                <Row label="Last paid">
                  {item.priceCents === null || item.priceAt === null ? (
                    "No price yet"
                  ) : (
                    <span className={priceIsFresh(item) ? "" : "text-secondary-500"}>
                      {formatCents(item.priceCents)} on {formatDate(item.priceAt)}
                      {!priceIsFresh(item) && " (requesting it looks the price up again)"}
                    </span>
                  )}
                </Row>
                <Row label="Requested">
                  {item.requestCount} time{item.requestCount === 1 ? "" : "s"}
                </Row>
              </dl>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-secondary-600 hover:text-primary-600"
              >
                {LINK_LABEL[item.linkKind]}
              </a>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to={`/request?catalog=${item.id}`}
              state={{ from: here } satisfies RequestFrom}
              className={primaryLink}
            >
              Request
            </Link>
            <Link
              to={`/request?wishlist=1&catalog=${item.id}`}
              state={{ from: here } satisfies RequestFrom}
              className={secondaryLink}
            >
              Add to wishlist
            </Link>
            {canEditCatalog && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </Card>
      )}
    </Page>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-secondary-500">{label}</dt>
      <dd className="text-secondary-900">{children}</dd>
    </>
  );
}

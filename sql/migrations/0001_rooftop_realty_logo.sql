-- Rooftop Realty's logo used to be the product's default mark, so every
-- company without a logo showed it. The product is now Joist, and a company
-- with no logo shows its own initials. Rooftop's logo goes back to being
-- what it is: Rooftop Realty's logo, on Rooftop Realty's row.
--
-- builtin/ keys resolve to assets/company-logos/ in this repository
-- (src/lib/companyLogo.ts), so the file ships with the code instead of
-- living in uploads/.
--
-- A new database already has this value in the baseline's starting rows.
-- This brings databases built before it to the same state. It only touches
-- the built-in row while it is still as the baseline left it, so an owner
-- who has since uploaded or removed a logo keeps that choice.
UPDATE public.companies
SET logo_storage_key = 'builtin/rooftop-realty.png'
WHERE id = 'c0000000-0000-4000-8000-000000000001'
  AND slug = 'rooftop'
  AND logo_storage_key IS NULL
  AND updated_at = created_at;

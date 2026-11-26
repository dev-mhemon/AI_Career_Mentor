import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPolicyPage, { metadata } from "./page";

describe("PrivacyPolicyPage", () => {
  it("exports clear page metadata for search engines and OAuth crawlers", () => {
    expect(metadata.title).toBe("Privacy Policy | AI Career Mentor");
    expect(typeof metadata.description).toBe("string");
    expect(metadata.description).toMatch(/AI Career Mentor/i);
  });

  it("renders all required Meta/Facebook OAuth compliance and data deletion sections", () => {
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeInTheDocument();

    expect(screen.getAllByText(/Facebook Login/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Google Sign-In/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/We do not sell your personal data\./i),
    ).toBeInTheDocument();

    const deletionSection = document.getElementById("data-deletion");
    expect(deletionSection).toBeInTheDocument();
    expect(deletionSection?.textContent).toMatch(/Settings\s*→\s*Account Deletion/i);
    expect(deletionSection?.textContent).toMatch(/Apps and Websites/i);

    const mailtoLinks = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href")?.startsWith("mailto:"));
    expect(mailtoLinks.length).toBeGreaterThan(0);

    const loginLinks = screen
      .getAllByRole("link", { name: /sign in/i })
      .filter((el) => el.getAttribute("href") === "/login");
    expect(loginLinks.length).toBeGreaterThan(0);

    const homeLinks = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href") === "/");
    expect(homeLinks.length).toBeGreaterThan(0);
  });
});

# Architecture Documentation

This directory contains design decisions, specifications, and architectural documentation for the Checkout API.

## 📂 Directory Structure

### Active Documentation

#### **[3ds-stateful-design/](./3ds-stateful-design/)**
Complete documentation for 3D Secure authentication implementation with stateful session management.

- **[README](./3ds-stateful-design/README.md)** - Navigation hub for 3DS implementation
- **[Architecture Decision](./3ds-stateful-design/ARCHITECTURE-3DS-Stateful-Design-Decision.md)** - Why stateful sessions for 3DS
- **[Integration Guide](./3ds-stateful-design/INTEGRATION-Payments-SDK-Mapping.md)** - Payment API v0.3.0 integration patterns
- **[Technical Specification](./3ds-stateful-design/SPEC-Authentication-Session-Library.md)** - Session service specification
- **[User Story](./3ds-stateful-design/USER-STORY-3DS-Validate-Capture-Implementation.md)** - Business requirements

**Status:** ✅ Active (v0.5.0) - Fully implemented and validated

### Historical Archives

#### **[payment-api-alignment-v0.4.0-archive/](./payment-api-alignment-v0.4.0-archive/)**
Historical documentation from the v0.4.0 release (October 2025) when the Checkout API was aligned with Payment API v0.2.0.

- Contains implementation plans, migration guides, and retrospectives
- **Status:** 📚 Historical Reference Only

## 🎯 Purpose

This architecture documentation serves two key purposes:

1. **Design Rationale** - Explains WHY architectural decisions were made
2. **Technical Specifications** - Provides detailed HOW for implementations

## 🔗 Related Documentation

- **[Developer Guides](../howto/)** - Practical implementation guides
- **[API Specification](../../openapi/)** - OpenAPI definitions
- **[Reference Implementation](../../lambda/)** - Source code examples
- **[Version Management](../VERSION-BUMP-GUIDE.md)** - Release procedures

## 📖 When to Use This Documentation

### "I need to understand the design decisions"
→ Read the Architecture Decision Records (ADR) in each subdirectory

### "I need technical specifications"
→ Consult the SPEC documents for detailed requirements

### "I need to implement a feature"
→ Start with [Developer Guides](../howto/) then reference architecture docs

### "I need historical context"
→ Browse the archived directories for past decisions

## 🏗️ Documentation Standards

All architecture documentation follows these conventions:

- **ARCHITECTURE-** prefix: Design decisions and rationale
- **SPEC-** prefix: Technical specifications
- **INTEGRATION-** prefix: Integration patterns and guides
- **USER-STORY-** prefix: Business requirements and acceptance criteria
- **README.md**: Navigation and context for each subdirectory

## 📅 Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.5.0 | Nov 2025 | 3DS stateful design with Payment API v0.3.0 |
| v0.4.0 | Oct 2025 | Payment API v0.2.0 alignment (archived) |
| v0.3.0 | Oct 2025 | Initial architecture documentation |

---

**Last Updated:** 2025-11-07
**Documentation Version:** 1.0
**Maintained by:** Platform Engineering Team
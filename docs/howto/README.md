# Developer Guides

Welcome to the Checkout API developer guides. These practical, task-oriented guides will help you integrate with the Checkout API and implement payment processing in your applications.

## 📚 Quick Navigation

### Getting Started
- **[Basic Payment Integration](./getting-started-payments.md)** - Start here if you're new to the Checkout API and payments-sdk
- **[Multi-Account AWS Deployment](./multi-account-deployment.md)** - Complete guide for deploying to AWS with multi-account setup

### Advanced Topics
- **[3DS Authentication Integration](./advanced-3ds-integration.md)** - Implement 3D Secure authentication with stateful sessions
- **[Version Management](../VERSION-BUMP-GUIDE.md)** - How to manage API versions and releases

## 🎯 Which Guide Should I Use?

### "I want to process a simple payment"
→ Start with [Basic Payment Integration](./getting-started-payments.md)

### "I need to implement 3D Secure authentication"
→ See [3DS Authentication Integration](./advanced-3ds-integration.md)

### "I'm deploying to AWS with separate accounts"
→ Follow [Multi-Account AWS Deployment](./multi-account-deployment.md)

### "I need to understand the architecture decisions"
→ Visit [Architecture Documentation](../architecture/)

## 📖 Documentation Structure

```
docs/
├── howto/                              # You are here - practical guides
│   ├── getting-started-payments.md    # Basic payment integration
│   ├── advanced-3ds-integration.md    # 3DS authentication flows
│   └── multi-account-deployment.md    # AWS deployment guide
│
├── architecture/                       # Design decisions and specifications
│   ├── 3ds-stateful-design/          # Complete 3DS implementation details
│   └── payment-api-alignment-v0.4.0-archive/  # Historical references
│
└── VERSION-BUMP-GUIDE.md             # Version management
```

## 🔗 Related Resources

- **[Checkout API OpenAPI Specification](../../openapi/checkout-openapi-unresolved.yaml)** - Full API specification
- **[Lambda Implementation](../../lambda/)** - Source code for Lambda handlers
- **[Infrastructure as Code](../../infra/)** - CDK stack definitions
- **[Example Client](../../examples/)** - Complete test suite and examples

## 💡 Best Practices

1. **Start Simple**: Begin with basic payment integration before tackling 3DS flows
2. **Use Secrets Manager**: Never hardcode credentials in production code
3. **Test Thoroughly**: Use the example client to test your integration
4. **Follow the Patterns**: The architecture documentation explains why certain patterns are used
5. **Version Carefully**: Follow the version bump guide for releases

## 🆘 Getting Help

- **Architecture Questions**: See [Architecture Documentation](../architecture/3ds-stateful-design/)
- **Implementation Issues**: Check the relevant guide's troubleshooting section
- **API Reference**: Consult the [OpenAPI Specification](../../openapi/checkout-openapi-unresolved.yaml)
- **Historical Context**: Browse [archived documentation](../architecture/payment-api-alignment-v0.4.0-archive/) for past decisions

---

**Last Updated:** 2025-11-07
**Documentation Version:** 1.0
**API Version:** v0.5.0